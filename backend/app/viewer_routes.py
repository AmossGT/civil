from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload
from . import models, services
from .database import get_db
from .security import require_roles

viewer = APIRouter(prefix="/viewer", tags=["Department Viewer Workspace"])

def get_viewer_dept_id(user: models.User, requested_dept_id: int | None, db: Session) -> int:
    if user.role == "admin":
        if requested_dept_id:
            return requested_dept_id
        if user.department_id:
            return user.department_id
        first_dept = db.query(models.Department).order_by(models.Department.id).first()
        if not first_dept:
            raise HTTPException(404, "No departments found")
        return first_dept.id
    if not user.department_id:
        raise HTTPException(403, "Viewer user is not assigned to any department")
    return user.department_id

@viewer.get("/department")
def get_viewer_department(
    department_id: int | None = None,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_roles("department_viewer", "admin"))
):
    dept_id = get_viewer_dept_id(user, department_id, db)
    dept = db.query(models.Department).options(joinedload(models.Department.officers)).filter_by(id=dept_id).first()
    if not dept:
        raise HTTPException(404, "Department not found")

    tenders_query = db.query(models.Tender).filter_by(department_id=dept_id)
    total_tenders = tenders_query.count()
    drafts = tenders_query.filter_by(status="draft").count()
    published = tenders_query.filter_by(status="published").count()
    awarded = tenders_query.filter_by(status="awarded").count()
    total_val = db.query(func.coalesce(func.sum(models.Tender.estimated_value), 0)).filter(
        models.Tender.department_id == dept_id
    ).scalar()

    return {
        "id": dept.id,
        "name": dept.name,
        "district": dept.district,
        "officers": [
            {
                "id": o.id,
                "name": o.name,
                "designation": o.designation,
                "office_phone": o.office_phone
            } for o in dept.officers
        ],
        "stats": {
            "total_tenders": total_tenders,
            "drafts": drafts,
            "published": published,
            "awarded": awarded,
            "total_estimated_value": float(total_val)
        }
    }

@viewer.get("/tenders")
def list_viewer_tenders(
    status: str | None = None,
    q: str | None = None,
    department_id: int | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    user: models.User = Depends(require_roles("department_viewer", "admin"))
):
    dept_id = get_viewer_dept_id(user, department_id, db)
    query = db.query(models.Tender).filter(models.Tender.department_id == dept_id)

    if status:
        query = query.filter(models.Tender.status == status)
    if q:
        query = query.filter(models.Tender.title.ilike(f"%{q}%") | models.Tender.tender_ref.ilike(f"%{q}%"))

    total = query.count()
    rows = query.options(
        joinedload(models.Tender.department).joinedload(models.Department.officers),
        joinedload(models.Tender.award).joinedload(models.Award.contractor).joinedload(models.Contractor.contacts),
        joinedload(models.Tender.documents)
    ).order_by(models.Tender.updated_at.desc()).offset((page - 1) * page_size).limit(page_size).all()

    return {
        "items": [services.public_tender(t, db, user) for t in rows],
        "total": total,
        "page": page,
        "page_size": page_size
    }

@viewer.get("/tenders/{ref}")
def get_viewer_tender_detail(
    ref: str,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_roles("department_viewer", "admin"))
):
    t = services.detail_query(db).filter_by(tender_ref=ref).first()
    if not t:
        raise HTTPException(404, "Tender not found")
    if user.role != "admin" and t.department_id != user.department_id:
        raise HTTPException(403, "Access restricted to your assigned department")
    return services.public_tender(t, db, user)

@viewer.get("/audit")
def list_viewer_audit(
    department_id: int | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
    user: models.User = Depends(require_roles("department_viewer", "admin"))
):
    dept_id = get_viewer_dept_id(user, department_id, db)
    # Get IDs of all tenders in this department
    tender_ids = [tid for (tid,) in db.query(models.Tender.id).filter_by(department_id=dept_id).all()]

    q = db.query(models.AuditLog).filter(
        models.AuditLog.table_name == "tenders",
        models.AuditLog.record_id.in_(tender_ids)
    ) if tender_ids else db.query(models.AuditLog).filter(False)

    total = q.count()
    rows = q.order_by(models.AuditLog.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()

    return {
        "items": [
            {
                "id": x.id,
                "user_id": x.user_id,
                "action": x.action,
                "table_name": x.table_name,
                "record_id": x.record_id,
                "old_value": x.old_value,
                "new_value": x.new_value,
                "created_at": x.created_at
            } for x in rows
        ],
        "total": total,
        "page": page,
        "page_size": page_size
    }
