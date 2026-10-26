import csv, io, secrets
from datetime import date
from pathlib import Path
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload
from . import models, schemas, services
from .config import settings
from .database import get_db
from .security import hash_password, rate_limit, require_roles

admin = APIRouter(prefix="/admin", tags=["Admin Management"])

def commit(db):
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "A record with those unique values already exists")

def get_tender(db, ref):
    t = services.detail_query(db).filter_by(tender_ref=ref).first()
    if not t:
        raise HTTPException(404, "Tender not found")
    return t

@admin.get("/review")
def review_queue(db: Session = Depends(get_db), user: models.User = Depends(require_roles("admin"))):
    pending = db.query(models.Tender).filter_by(status="pending_review").all()
    awards = db.query(models.Award).options(joinedload(models.Award.tender)).filter_by(status="pending_review").all()
    return {
        "tenders": [{"tender_ref": t.tender_ref, "title": t.title, "department": t.department.name, "status": t.status} for t in pending],
        "awards": [{"tender_ref": a.tender.tender_ref, "title": a.tender.title, "awarded_value": float(a.awarded_value), "aoc_date": a.aoc_date, "status": a.status} for a in awards]
    }

@admin.post("/tenders/{ref}/verify")
def verify(ref: str, db: Session = Depends(get_db), user: models.User = Depends(require_roles("admin"))):
    t = get_tender(db, ref)
    if t.status == "pending_review":
        old = services.snapshot(t)
        t.status = "published"
        t.verified_by = user.id
        t.verified_at = models.utcnow()
        services.audit(db, user.id, "verify", "tenders", t.id, old, services.snapshot(t))
        commit(db)
        return {"tender_ref": ref, "status": t.status}
    if t.award and t.award.status == "pending_review":
        a = t.award
        old = {"status": a.status, "awarded_value": float(a.awarded_value)}
        a.status = "verified"
        a.verified_by = user.id
        a.verified_at = models.utcnow()
        t.status = "awarded"
        services.audit(db, user.id, "verify", "awards", a.id, old, {"status": a.status, "awarded_value": float(a.awarded_value)})
        commit(db)
        return {"tender_ref": ref, "status": t.status}
    raise HTTPException(409, "No pending tender or award review for this reference")

@admin.post("/tenders/{ref}/reject")
def reject(ref: str, body: schemas.RejectIn, db: Session = Depends(get_db), user: models.User = Depends(require_roles("admin"))):
    t = get_tender(db, ref)
    if t.status == "pending_review":
        old = services.snapshot(t)
        t.status = "rejected"
        t.rejection_comment = body.comment
        services.audit(db, user.id, "reject", "tenders", t.id, old, {**services.snapshot(t), "rejection_comment": body.comment})
        commit(db)
        return {"tender_ref": ref, "status": t.status}
    if t.award and t.award.status == "pending_review":
        a = t.award
        old = {"status": a.status}
        a.status = "rejected"
        services.audit(db, user.id, "reject", "awards", a.id, old, {"status": a.status, "comment": body.comment})
        commit(db)
        return {"tender_ref": ref, "award_status": a.status}
    raise HTTPException(409, "No pending tender or award review for this reference")

# --- Direct Tender CRUD for Admin ---

@admin.post("/tenders", status_code=201)
def create_tender(body: schemas.TenderAdminCreate, db: Session = Depends(get_db), user: models.User = Depends(require_roles("admin"))):
    d = db.get(models.Department, body.department_id)
    if not d:
        raise HTTPException(404, "Department not found")

    t = models.Tender(
        tender_ref=body.tender_ref,
        department_id=d.id,
        title=body.title,
        description=body.description,
        extra_data=body.extra_data,
        estimated_value=body.estimated_value,
        bid_open_date=body.bid_open_date,
        bid_close_date=body.bid_close_date,
        location_label=body.location_label,
        status=body.status,
        created_by=user.id
    )
    if body.latitude is not None and body.longitude is not None:
        services.set_location(t, body.latitude, body.longitude)

    db.add(t)
    db.flush()
    services.audit(db, user.id, "create", "tenders", t.id, None, services.snapshot(t))
    commit(db)
    return {"tender_ref": t.tender_ref, "status": t.status}

@admin.patch("/tenders/{ref}")
def update_tender(ref: str, body: schemas.TenderAdminPatch, db: Session = Depends(get_db), user: models.User = Depends(require_roles("admin"))):
    t = get_tender(db, ref)
    old = services.snapshot(t)

    data = body.model_dump(exclude_unset=True)
    if "department_id" in data and data["department_id"] is not None:
        if not db.get(models.Department, data["department_id"]):
            raise HTTPException(404, "Department not found")
        t.department_id = data["department_id"]

    lat = data.pop("latitude", None)
    lng = data.pop("longitude", None)
    for key, value in data.items():
        if key != "department_id":
            setattr(t, key, value)

    if "latitude" in body.model_fields_set or "longitude" in body.model_fields_set:
        services.set_location(t, lat, lng)

    services.audit(db, user.id, "update", "tenders", t.id, old, services.snapshot(t))
    commit(db)
    return {"tender_ref": ref, "status": t.status}

@admin.delete("/tenders/{ref}")
def delete_tender(ref: str, db: Session = Depends(get_db), user: models.User = Depends(require_roles("admin"))):
    t = get_tender(db, ref)
    old = services.snapshot(t)
    tid = t.id
    db.delete(t)
    services.audit(db, user.id, "delete", "tenders", tid, old, None)
    commit(db)
    return {"ok": True, "tender_ref": ref}

# --- Award Management ---

@admin.post("/tenders/{ref}/award", status_code=201)
def set_award(ref: str, body: schemas.AwardAdminCreate, db: Session = Depends(get_db), user: models.User = Depends(require_roles("admin"))):
    t = get_tender(db, ref)
    if not db.get(models.Contractor, body.contractor_id):
        raise HTTPException(404, "Contractor not found")

    if t.award:
        a = t.award
        old = {"status": a.status, "awarded_value": float(a.awarded_value), "contractor_id": a.contractor_id}
        a.contractor_id = body.contractor_id
        a.awarded_value = body.awarded_value
        a.aoc_date = body.aoc_date
        a.status = body.status
        if body.status == "verified":
            a.verified_by = user.id
            a.verified_at = models.utcnow()
            t.status = "awarded"
        action = "update"
    else:
        a = models.Award(
            tender_id=t.id,
            contractor_id=body.contractor_id,
            awarded_value=body.awarded_value,
            aoc_date=body.aoc_date,
            status=body.status
        )
        if body.status == "verified":
            a.verified_by = user.id
            a.verified_at = models.utcnow()
            t.status = "awarded"
        db.add(a)
        db.flush()
        old = None
        action = "create"

    services.audit(db, user.id, action, "awards", a.id, old, {
        "tender_ref": ref,
        "contractor_id": a.contractor_id,
        "awarded_value": float(a.awarded_value),
        "aoc_date": str(a.aoc_date) if a.aoc_date else None,
        "status": a.status
    })
    commit(db)
    return {"tender_ref": ref, "award_status": a.status, "tender_status": t.status}

@admin.delete("/tenders/{ref}/award")
def delete_award(ref: str, db: Session = Depends(get_db), user: models.User = Depends(require_roles("admin"))):
    t = get_tender(db, ref)
    if not t.award:
        raise HTTPException(404, "No award found on this tender")
    aid = t.award.id
    old = {"contractor_id": t.award.contractor_id, "awarded_value": float(t.award.awarded_value), "status": t.award.status}
    db.delete(t.award)
    if t.status == "awarded":
        t.status = "published"
    services.audit(db, user.id, "delete", "awards", aid, old, None)
    commit(db)
    return {"ok": True, "tender_ref": ref, "tender_status": t.status}

# --- Document Management (Saved to Docker Volume) ---

@admin.post("/tenders/{ref}/documents", status_code=201)
def upload_document(
    ref: str,
    file: UploadFile = File(...),
    document_type: str = Form("general"),
    label: str = Form(""),
    db: Session = Depends(get_db),
    user: models.User = Depends(require_roles("admin"))
):
    t = get_tender(db, ref)
    if not file.filename:
        raise HTTPException(422, "Filename required")

    suffix = Path(file.filename).suffix.lower()
    allowed_suffixes = {".pdf", ".kmz", ".kml", ".zip", ".csv"}
    if suffix not in allowed_suffixes:
        raise HTTPException(415, f"Unsupported file type. Allowed: {', '.join(allowed_suffixes)}")

    data = file.file.read(settings.max_upload_bytes + 1)
    if len(data) > settings.max_upload_bytes:
        raise HTTPException(413, f"File exceeds maximum size of {settings.max_upload_bytes // (1024*1024)} MB")

    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    storage_name = f"admin_uploads/{secrets.token_hex(16)}{suffix}"
    target_path = (settings.upload_dir / storage_name).resolve()
    target_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.write_bytes(data)

    content_type = file.content_type or "application/octet-stream"
    doc = models.TenderDocument(
        tender_id=t.id,
        document_type=document_type,
        label=label or Path(file.filename).stem,
        source_filename=Path(file.filename).name,
        storage_name=storage_name,
        content_type=content_type,
        uploaded_by=user.id
    )
    db.add(doc)
    db.flush()
    services.audit(db, user.id, "upload", "tender_documents", doc.id, None, {
        "tender_ref": ref,
        "storage_name": storage_name,
        "filename": doc.source_filename,
        "document_type": document_type
    })
    commit(db)
    return services.public_document(ref, doc)

@admin.delete("/tenders/{ref}/documents/{document_id}")
def delete_document(ref: str, document_id: int, db: Session = Depends(get_db), user: models.User = Depends(require_roles("admin"))):
    t = get_tender(db, ref)
    doc = db.query(models.TenderDocument).filter_by(id=document_id, tender_id=t.id).first()
    if not doc:
        raise HTTPException(404, "Document not found")

    path = services.safe_upload_path(doc.storage_name)
    if path and path.is_file():
        try:
            path.unlink()
        except OSError:
            pass

    did = doc.id
    old = {"label": doc.label, "storage_name": doc.storage_name, "source_filename": doc.source_filename}
    db.delete(doc)
    services.audit(db, user.id, "delete", "tender_documents", did, old, None)
    commit(db)
    return {"ok": True, "document_id": did}

# --- Departments & Contractors ---

@admin.post("/departments", status_code=201)
def create_department(body: schemas.DepartmentCreate, db: Session = Depends(get_db), user: models.User = Depends(require_roles("admin"))):
    d = models.Department(name=body.name, district=body.district)
    db.add(d)
    db.flush()
    services.audit(db, user.id, "create", "departments", d.id, None, {"name": d.name, "district": d.district})
    commit(db)
    return {"id": d.id, "name": d.name}

@admin.post("/departments/{department_id}/officers", status_code=201)
def add_officer(department_id: int, body: schemas.OfficerCreate, db: Session = Depends(get_db), user: models.User = Depends(require_roles("admin"))):
    d = db.get(models.Department, department_id)
    if not d:
        raise HTTPException(404, "Department not found")
    o = models.Officer(department_id=d.id, name=body.name, designation=body.designation, office_phone=body.office_phone)
    db.add(o)
    db.flush()
    services.audit(db, user.id, "create", "officers", o.id, None, {"department_id": d.id, "name": o.name, "designation": o.designation, "office_phone": o.office_phone})
    commit(db)
    return {"id": o.id}

@admin.post("/contractors", status_code=201)
def create_contractor(body: schemas.ContractorCreate, db: Session = Depends(get_db), user: models.User = Depends(require_roles("admin"))):
    c = models.Contractor(company_name=body.company_name, registration_no=body.registration_no)
    db.add(c)
    db.flush()
    services.audit(db, user.id, "create", "contractors", c.id, None, {"company_name": c.company_name, "registration_no": c.registration_no})
    commit(db)
    return {"id": c.id, "company_name": c.company_name}

@admin.post("/contractors/{contractor_id}/contacts", status_code=201)
def add_contact(contractor_id: int, body: schemas.ContactCreate, db: Session = Depends(get_db), user: models.User = Depends(require_roles("admin"))):
    c = db.get(models.Contractor, contractor_id)
    if not c:
        raise HTTPException(404, "Contractor not found")
    x = models.ContractorContact(contractor_id=c.id, name=body.name, role=body.role, office_phone=body.office_phone)
    db.add(x)
    db.flush()
    services.audit(db, user.id, "create", "contractor_contacts", x.id, None, {"contractor_id": c.id, "name": x.name, "role": x.role, "office_phone": x.office_phone})
    commit(db)
    return {"id": x.id}

# --- User Provisioning ---

@admin.get("/users")
def list_users(db: Session = Depends(get_db), user: models.User = Depends(require_roles("admin"))):
    rows = db.query(models.User).order_by(models.User.id).all()
    return [{"id": u.id, "email": u.email, "role": u.role, "department_id": u.department_id, "is_active": u.is_active} for u in rows]

@admin.post("/users", status_code=201)
def create_user(body: schemas.UserCreate, db: Session = Depends(get_db), user: models.User = Depends(require_roles("admin"))):
    if body.role == "department_viewer" and (not body.department_id or not db.get(models.Department, body.department_id)):
        raise HTTPException(422, "Department viewer account requires a valid department")
    if body.role == "admin" and body.department_id is not None:
        raise HTTPException(422, "Admin accounts cannot be assigned a department")

    u = models.User(
        email=body.email.lower(),
        password_hash=hash_password(body.password),
        role=body.role,
        department_id=body.department_id,
        is_active=True,
        token_version=1
    )
    db.add(u)
    db.flush()
    services.audit(db, user.id, "create", "users", u.id, None, {"email": u.email, "role": u.role, "department_id": u.department_id})
    commit(db)
    return {"id": u.id, "email": u.email, "role": u.role, "department_id": u.department_id, "is_active": u.is_active}

@admin.patch("/users/{user_id}")
def update_user(user_id: int, body: schemas.UserPatch, db: Session = Depends(get_db), user: models.User = Depends(require_roles("admin"))):
    target = db.get(models.User, user_id)
    if not target:
        raise HTTPException(404, "User not found")
    old = {"role": target.role, "department_id": target.department_id, "is_active": target.is_active}

    if body.role:
        if body.role == "department_viewer" and not (body.department_id or target.department_id):
            raise HTTPException(422, "Department viewer requires a valid department")
        if body.role == "admin":
            target.department_id = None
        target.role = body.role

    if body.department_id is not None:
        if not db.get(models.Department, body.department_id):
            raise HTTPException(404, "Department not found")
        target.department_id = body.department_id

    if body.is_active is not None:
        target.is_active = body.is_active

    if body.password:
        target.password_hash = hash_password(body.password)
        target.token_version += 1  # revoke existing tokens on password reset

    services.audit(db, user.id, "update", "users", target.id, old, {
        "role": target.role,
        "department_id": target.department_id,
        "is_active": target.is_active
    })
    commit(db)
    return {"id": target.id, "email": target.email, "role": target.role, "department_id": target.department_id, "is_active": target.is_active}

# --- Audit Logs ---

@admin.get("/audit")
def audit_log(page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200), db: Session = Depends(get_db), user: models.User = Depends(require_roles("admin"))):
    q = db.query(models.AuditLog)
    total = q.count()
    rows = q.order_by(models.AuditLog.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {
        "items": [{
            "id": x.id,
            "user_id": x.user_id,
            "action": x.action,
            "table_name": x.table_name,
            "record_id": x.record_id,
            "old_value": x.old_value,
            "new_value": x.new_value,
            "created_at": x.created_at
        } for x in rows],
        "total": total,
        "page": page,
        "page_size": page_size
    }

# --- Two-Pass Atomic CSV Import ---

@admin.post("/import/tenders")
def import_tenders(file: UploadFile = File(...), db: Session = Depends(get_db), user: models.User = Depends(require_roles("admin"))):
    rate_limit(f"import:{user.id}", max_requests=5, window_seconds=60)
    if not file.filename or Path(file.filename).suffix.lower() != ".csv":
        raise HTTPException(415, "Upload a CSV file")

    raw = file.file.read(5 * 1024 * 1024 + 1)
    if len(raw) > 5 * 1024 * 1024:
        raise HTTPException(413, "CSV exceeds 5 MB")
    try:
        reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig")))
    except UnicodeDecodeError:
        raise HTTPException(422, "CSV must be UTF-8 encoded")

    required = {"tender_ref", "department_id", "title", "estimated_value"}
    if not reader.fieldnames or not required.issubset(set(reader.fieldnames)):
        raise HTTPException(422, "CSV needs tender_ref, department_id, title, estimated_value columns")

    # PASS 1: Validate all rows before committing anything
    errors = []
    validated_rows = []
    existing_refs = {t[0] for t in db.query(models.Tender.tender_ref).all()}
    batch_refs = set()

    for line, row in enumerate(reader, start=2):
        ref = (row.get("tender_ref") or "").strip()
        if not ref:
            errors.append({"line": line, "error": "Missing tender_ref"})
            continue
        if ref in existing_refs or ref in batch_refs:
            errors.append({"line": line, "error": f"Duplicate tender_ref '{ref}'"})
            continue
        batch_refs.add(ref)

        try:
            dept_id = int(row["department_id"])
            if not db.get(models.Department, dept_id):
                errors.append({"line": line, "error": f"Unknown department_id {dept_id}"})
                continue
        except (ValueError, TypeError):
            errors.append({"line": line, "error": "department_id must be an integer"})
            continue

        raw_est = row.get("estimated_value")
        try:
            est_val = float(raw_est) if raw_est else None
            if est_val is not None and est_val <= 0:
                errors.append({"line": line, "error": "estimated_value must be greater than 0"})
                continue
        except ValueError:
            errors.append({"line": line, "error": "Invalid estimated_value number"})
            continue

        open_d = None
        close_d = None
        try:
            if row.get("bid_open_date"):
                open_d = date.fromisoformat(row["bid_open_date"].strip())
            if row.get("bid_close_date"):
                close_d = date.fromisoformat(row["bid_close_date"].strip())
            if open_d and close_d and close_d < open_d:
                errors.append({"line": line, "error": "bid_close_date must be >= bid_open_date"})
                continue
        except ValueError as e:
            errors.append({"line": line, "error": f"Invalid date format (use YYYY-MM-DD): {e}"})
            continue

        lat = None
        lng = None
        if row.get("latitude") and row.get("longitude"):
            try:
                lat = float(row["latitude"])
                lng = float(row["longitude"])
                if not (-90 <= lat <= 90 and -180 <= lng <= 180):
                    errors.append({"line": line, "error": "Coordinates out of bounds"})
                    continue
            except ValueError:
                errors.append({"line": line, "error": "Invalid coordinates"})
                continue

        validated_rows.append({
            "tender_ref": ref,
            "department_id": dept_id,
            "title": row["title"].strip(),
            "description": row.get("description") or None,
            "estimated_value": est_val,
            "bid_open_date": open_d,
            "bid_close_date": close_d,
            "location_label": row.get("location_label") or None,
            "latitude": lat,
            "longitude": lng,
            "status": row.get("status") or "draft"
        })

    # If any error found, reject the whole batch (atomic)
    if errors:
        return {"created": 0, "errors": errors}

    # PASS 2: All rows valid, insert inside a single atomic transaction
    created = 0
    try:
        for item in validated_rows:
            t = models.Tender(
                tender_ref=item["tender_ref"],
                department_id=item["department_id"],
                title=item["title"],
                description=item["description"],
                estimated_value=item["estimated_value"],
                bid_open_date=item["bid_open_date"],
                bid_close_date=item["bid_close_date"],
                location_label=item["location_label"],
                status=item["status"],
                created_by=user.id
            )
            if item["latitude"] is not None and item["longitude"] is not None:
                services.set_location(t, item["latitude"], item["longitude"])
            db.add(t)
            db.flush()
            services.audit(db, user.id, "create", "tenders", t.id, None, services.snapshot(t))
            created += 1
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(500, f"Failed to commit batch import: {exc}")

    return {"created": created, "errors": []}
