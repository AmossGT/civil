import json
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from geoalchemy2 import Geography, Geometry
from sqlalchemy import cast, func, or_
from sqlalchemy.orm import Session, joinedload
from . import models, services
from .database import get_db
from .security import get_current_user

public = APIRouter()

def paged(db, query, page, page_size, user=None):
    total = query.order_by(None).count()
    rows = query.options(
        joinedload(models.Tender.department).joinedload(models.Department.officers),
        joinedload(models.Tender.award).joinedload(models.Award.contractor).joinedload(models.Contractor.contacts),
        joinedload(models.Tender.documents),
        joinedload(models.Tender.procurement_identifier)
    ).order_by(models.Tender.updated_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {"items": [services.public_tender(t, db, user) for t in rows], "total": total, "page": page, "page_size": page_size}

def can_view_tender(t: models.Tender, user: models.User | None) -> bool:
    if not t:
        return False
    if user and user.role == "admin":
        return True
    if user and user.role == "department_viewer" and user.department_id == t.department_id:
        return True
    return t.status in ("published", "awarded")

@public.get("/health")
def health():
    return {"status": "ok"}

@public.get("/tenders")
def list_tenders(
    db: Session = Depends(get_db),
    user: models.User | None = Depends(get_current_user),
    q: str | None = None,
    department_id: int | None = None,
    contractor_id: int | None = None,
    status: str | None = None,
    min_value: float | None = None,
    max_value: float | None = None,
    opens_after: date | None = None,
    closes_before: date | None = None,
    sort: str = "-updated_at",
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100)
):
    query = services.apply_filters(services.scoped_tenders(db, user), q, department_id, contractor_id, min_value, max_value, opens_after, closes_before)
    if status:
        if user and user.role in ("admin", "department_viewer"):
            query = query.filter(models.Tender.status == status)
        elif status in ("published", "awarded"):
            query = query.filter(models.Tender.status == status)

    if sort == "-bid_close_date":
        query = query.order_by(models.Tender.bid_close_date.desc().nullslast())
    elif sort == "bid_close_date":
        query = query.order_by(models.Tender.bid_close_date.asc().nullslast())
    elif sort == "-estimated_value":
        query = query.order_by(models.Tender.estimated_value.desc())
    elif sort == "estimated_value":
        query = query.order_by(models.Tender.estimated_value.asc())

    return paged(db, query, page, page_size, user)

@public.get("/tenders/nearby")
def nearby(
    lat: float = Query(ge=-90, le=90),
    lng: float = Query(ge=-180, le=180),
    radius_km: float = Query(10, gt=0, le=500),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    user: models.User | None = Depends(get_current_user)
):
    point = func.ST_SetSRID(func.ST_MakePoint(lng, lat), 4326).cast(Geography)
    query = services.scoped_tenders(db, user).filter(
        models.Tender.location.isnot(None),
        func.ST_DWithin(models.Tender.location, point, radius_km * 1000)
    ).order_by(func.ST_Distance(models.Tender.location, point))
    return paged(db, query, page, page_size, user)

@public.get("/tenders/map")
def map_search(bbox: str = Query(description="west,south,east,north"), db: Session = Depends(get_db)):
    try:
        west, south, east, north = map(float, bbox.split(","))
    except (ValueError, TypeError):
        raise HTTPException(422, "bbox must be west,south,east,north")
    if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
        raise HTTPException(422, "bbox coordinates are out of range")

    envelope = func.ST_MakeEnvelope(west, south, east, north, 4326)
    rows = services.visible_tenders(db).filter(
        models.Tender.location.isnot(None),
        func.ST_Intersects(cast(models.Tender.location, Geometry), envelope)
    ).limit(1000).all()

    pins = []
    for t in rows:
        p = db.query(func.ST_Y(cast(t.location, Geometry)), func.ST_X(cast(t.location, Geometry))).filter(models.Tender.id == t.id).first()
        if p and p[0] is not None:
            pins.append({"tender_ref": t.tender_ref, "title": t.title, "status": t.status, "latitude": float(p[0]), "longitude": float(p[1])})

    simplified = func.ST_SimplifyPreserveTopology(cast(models.TenderSpatialFeature.geometry, Geometry), 0.00004)
    features_query = db.query(
        models.TenderSpatialFeature,
        models.Tender.tender_ref,
        models.Tender.title,
        models.Tender.status,
        func.ST_AsGeoJSON(simplified)
    ).join(models.Tender).filter(
        models.Tender.status.in_(["published", "awarded"]),
        func.ST_Intersects(cast(models.TenderSpatialFeature.geometry, Geometry), envelope),
    ).order_by(models.Tender.tender_ref, models.TenderSpatialFeature.feature_name).limit(100)

    route_features = []
    for feature, ref, title, tender_status, geojson in features_query.all():
        route_features.append({
            "type": "Feature",
            "geometry": json.loads(geojson),
            "properties": {
                "tender_ref": ref,
                "tender_title": title,
                "tender_status": tender_status,
                "name": feature.feature_name,
                "source_filename": feature.source_filename,
                "geometry_type": feature.geometry_type,
                **(feature.properties or {})
            }
        })
    return {"items": pins, "total": len(pins), "features": route_features, "feature_total": len(route_features)}

@public.get("/stats")
def public_stats(db: Session = Depends(get_db)):
    published = db.query(models.Tender).filter_by(status="published").count()
    public_awards = db.query(models.Award).join(models.Tender).filter(
        or_(models.Award.status == "verified", (models.Award.status == "pending_review") & (models.Tender.extra_data["prototype_data"].as_boolean() == True))
    )
    awards = public_awards.count()
    total = public_awards.with_entities(func.coalesce(func.sum(models.Award.awarded_value), 0)).scalar()
    prototype_count = db.query(models.Tender).filter(models.Tender.extra_data["prototype_data"].as_boolean() == True).count()
    return {
        "published_tenders": published,
        "awards_disclosed": awards,
        "total_awarded_value": float(total),
        "departments": db.query(models.Department).count(),
        "prototype_records": prototype_count
    }

@public.get("/activity")
def public_activity(limit: int = Query(5, ge=1, le=20), db: Session = Depends(get_db)):
    rows = services.visible_tenders(db).options(joinedload(models.Tender.department)).order_by(models.Tender.updated_at.desc()).limit(limit).all()
    return {
        "items": [{
            "tender_ref": t.tender_ref,
            "title": t.title,
            "department": t.department.name,
            "status": t.status,
            "event": "Prototype record imported" if (t.extra_data or {}).get("prototype_data") else ("Award disclosed" if t.status == "awarded" else "Verified and published"),
            "created_at": t.updated_at
        } for t in rows]
    }

@public.get("/tenders/{ref}")
def tender_detail(ref: str, db: Session = Depends(get_db), user: models.User | None = Depends(get_current_user)):
    t = services.detail_query(db).filter_by(tender_ref=ref).first()
    if not can_view_tender(t, user):
        raise HTTPException(404, "Tender not found")
    return services.public_tender(t, db, user)

@public.get("/tenders/{ref}/documents")
def tender_documents(ref: str, db: Session = Depends(get_db), user: models.User | None = Depends(get_current_user)):
    t = services.detail_query(db).filter_by(tender_ref=ref).first()
    if not can_view_tender(t, user):
        raise HTTPException(404, "Tender not found")
    return [services.public_document(ref, d) for d in t.documents]

@public.get("/tenders/{ref}/documents/{document_id}")
def tender_document(ref: str, document_id: int, db: Session = Depends(get_db), user: models.User | None = Depends(get_current_user)):
    t = services.detail_query(db).filter_by(tender_ref=ref).first()
    if not can_view_tender(t, user):
        raise HTTPException(404, "Document not found")
    document = db.query(models.TenderDocument).filter_by(id=document_id, tender_id=t.id).first()
    path = services.safe_upload_path(document.storage_name) if document else None
    if not document or not path or not path.is_file():
        raise HTTPException(404, "Document not found")
    return FileResponse(path, media_type=document.content_type, filename=document.source_filename)

@public.get("/tenders/{ref}/work-order")
def work_order(ref: str, db: Session = Depends(get_db), user: models.User | None = Depends(get_current_user)):
    t = db.query(models.Tender).filter_by(tender_ref=ref).first()
    if not can_view_tender(t, user) or not t.work_order_path:
        raise HTTPException(404, "Work order not found")
    path = services.safe_upload_path(t.work_order_path)
    if not path or not path.is_file():
        raise HTTPException(404, "Work order not found")
    return FileResponse(path, media_type="application/pdf", filename=f"{ref}-work-order.pdf")

@public.get("/departments")
def departments(db: Session = Depends(get_db)):
    return [{"id": d.id, "name": d.name, "district": d.district} for d in db.query(models.Department).order_by(models.Department.name).all()]

@public.get("/departments/{department_id}")
def department_detail(department_id: int, db: Session = Depends(get_db), user: models.User | None = Depends(get_current_user)):
    d = db.query(models.Department).options(joinedload(models.Department.officers)).filter_by(id=department_id).first()
    if not d:
        raise HTTPException(404, "Department not found")
    query = services.scoped_tenders(db, user).filter_by(department_id=d.id).order_by(models.Tender.updated_at.desc()).limit(100)
    rows = query.all()
    return {
        "id": d.id,
        "name": d.name,
        "district": d.district,
        "officers": [{"id": o.id, "name": o.name, "designation": o.designation, "office_phone": o.office_phone} for o in d.officers],
        "tenders": [services.public_tender(t, db, user) for t in rows]
    }

@public.get("/contractors")
def contractors(q: str | None = None, page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100), db: Session = Depends(get_db)):
    query = db.query(models.Contractor)
    if q:
        query = query.filter(models.Contractor.company_name.ilike(f"%{q}%"))
    total = query.count()
    rows = query.order_by(models.Contractor.company_name).offset((page - 1) * page_size).limit(page_size).all()
    return {
        "items": [{
            "id": c.id,
            "company_name": c.company_name,
            "registration_no": c.registration_no,
            "contacts": [{"id": x.id, "name": x.name, "role": x.role, "office_phone": x.office_phone} for x in c.contacts]
        } for c in rows],
        "total": total,
        "page": page,
        "page_size": page_size
    }

@public.get("/contractors/{contractor_id}")
def contractor_detail(contractor_id: int, db: Session = Depends(get_db), user: models.User | None = Depends(get_current_user)):
    c = db.query(models.Contractor).options(joinedload(models.Contractor.contacts)).filter_by(id=contractor_id).first()
    if not c:
        raise HTTPException(404, "Contractor not found")
    awards = db.query(models.Award).options(joinedload(models.Award.tender).joinedload(models.Tender.department)).filter_by(contractor_id=c.id, status="verified").all()
    return {
        "id": c.id,
        "company_name": c.company_name,
        "registration_no": c.registration_no,
        "contacts": [{"id": x.id, "name": x.name, "role": x.role, "office_phone": x.office_phone} for x in c.contacts],
        "awarded_works": [services.public_tender(a.tender, db, user) for a in awards if a.tender.status == "awarded"]
    }
