import csv,io
from datetime import date
from pathlib import Path
from fastapi import APIRouter,Depends,File,HTTPException,Query,UploadFile
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session,joinedload
from . import models,schemas,services
from .database import get_db
from .security import hash_password,require_roles
admin=APIRouter()
def commit(db):
    try: db.commit()
    except IntegrityError:
        db.rollback();raise HTTPException(409,"A record with those unique values already exists")
def get_tender(db,ref):
    t=services.detail_query(db).filter_by(tender_ref=ref).first()
    if not t: raise HTTPException(404,"Tender not found")
    return t
@admin.get("/admin/review")
def review_queue(db:Session=Depends(get_db),user:models.User=Depends(require_roles("admin"))):
    pending=db.query(models.Tender).filter_by(status="pending_review").all()
    awards=db.query(models.Award).options(joinedload(models.Award.tender)).filter_by(status="pending_review").all()
    return {"tenders":[{"tender_ref":t.tender_ref,"title":t.title,"department":t.department.name,"status":t.status} for t in pending],"awards":[{"tender_ref":a.tender.tender_ref,"title":a.tender.title,"awarded_value":float(a.awarded_value),"aoc_date":a.aoc_date,"status":a.status} for a in awards]}
@admin.post("/tenders/{ref}/verify")
def verify(ref:str,db:Session=Depends(get_db),user:models.User=Depends(require_roles("admin"))):
    t=get_tender(db,ref)
    if t.status=="pending_review":
        old=services.snapshot(t);t.status="published";t.verified_by=user.id;t.verified_at=models.utcnow();services.audit(db,user.id,"verify","tenders",t.id,old,services.snapshot(t));commit(db);return {"tender_ref":ref,"status":t.status}
    if t.award and t.award.status=="pending_review":
        a=t.award;old={"status":a.status,"awarded_value":float(a.awarded_value)};a.status="verified";a.verified_by=user.id;a.verified_at=models.utcnow();t.status="awarded";services.audit(db,user.id,"verify","awards",a.id,old,{"status":a.status,"awarded_value":float(a.awarded_value)});commit(db);return {"tender_ref":ref,"status":t.status}
    raise HTTPException(409,"No pending tender or award review for this reference")
@admin.post("/tenders/{ref}/reject")
def reject(ref:str,body:schemas.RejectIn,db:Session=Depends(get_db),user:models.User=Depends(require_roles("admin"))):
    t=get_tender(db,ref)
    if t.status=="pending_review":
        old=services.snapshot(t);t.status="rejected";t.rejection_comment=body.comment;services.audit(db,user.id,"reject","tenders",t.id,old,{**services.snapshot(t),"rejection_comment":body.comment});commit(db);return {"tender_ref":ref,"status":t.status}
    if t.award and t.award.status=="pending_review":
        a=t.award;old={"status":a.status};a.status="rejected";services.audit(db,user.id,"reject","awards",a.id,old,{"status":a.status,"comment":body.comment});commit(db);return {"tender_ref":ref,"award_status":a.status}
    raise HTTPException(409,"No pending tender or award review for this reference")
@admin.post("/departments",status_code=201)
def create_department(body:schemas.DepartmentCreate,db:Session=Depends(get_db),user:models.User=Depends(require_roles("admin"))):
    d=models.Department(name=body.name,district=body.district);db.add(d);db.flush();services.audit(db,user.id,"create","departments",d.id,None,{"name":d.name,"district":d.district});commit(db);return {"id":d.id,"name":d.name}
@admin.post("/departments/{department_id}/officers",status_code=201)
def add_officer(department_id:int,body:schemas.OfficerCreate,db:Session=Depends(get_db),user:models.User=Depends(require_roles("admin"))):
    d=db.get(models.Department,department_id)
    if not d: raise HTTPException(404,"Department not found")
    o=models.Officer(department_id=d.id,name=body.name,designation=body.designation,office_phone=body.office_phone);db.add(o);db.flush();services.audit(db,user.id,"create","officers",o.id,None,{"department_id":d.id,"name":o.name,"designation":o.designation,"office_phone":o.office_phone});commit(db);return {"id":o.id}
@admin.post("/contractors",status_code=201)
def create_contractor(body:schemas.ContractorCreate,db:Session=Depends(get_db),user:models.User=Depends(require_roles("admin"))):
    c=models.Contractor(company_name=body.company_name,registration_no=body.registration_no);db.add(c);db.flush();services.audit(db,user.id,"create","contractors",c.id,None,{"company_name":c.company_name,"registration_no":c.registration_no});commit(db);return {"id":c.id,"company_name":c.company_name}
@admin.post("/contractors/{contractor_id}/contacts",status_code=201)
def add_contact(contractor_id:int,body:schemas.ContactCreate,db:Session=Depends(get_db),user:models.User=Depends(require_roles("admin"))):
    c=db.get(models.Contractor,contractor_id)
    if not c: raise HTTPException(404,"Contractor not found")
    x=models.ContractorContact(contractor_id=c.id,name=body.name,role=body.role,office_phone=body.office_phone);db.add(x);db.flush();services.audit(db,user.id,"create","contractor_contacts",x.id,None,{"contractor_id":c.id,"name":x.name,"role":x.role,"office_phone":x.office_phone});commit(db);return {"id":x.id}
@admin.post("/users",status_code=201)
def create_user(body:schemas.UserCreate,db:Session=Depends(get_db),user:models.User=Depends(require_roles("admin"))):
    if body.role=="officer" and (not body.department_id or not db.get(models.Department,body.department_id)): raise HTTPException(422,"Officer account requires a valid department")
    if body.role=="admin" and body.department_id is not None: raise HTTPException(422,"Admin accounts cannot be assigned a department")
    u=models.User(email=body.email.lower(),password_hash=hash_password(body.password),role=body.role,department_id=body.department_id,is_active=True);db.add(u);db.flush();services.audit(db,user.id,"create","users",u.id,None,{"email":u.email,"role":u.role,"department_id":u.department_id});commit(db);return {"id":u.id,"email":u.email,"role":u.role}
@admin.get("/audit")
def audit_log(page:int=Query(1,ge=1),page_size:int=Query(50,ge=1,le=200),db:Session=Depends(get_db),user:models.User=Depends(require_roles("admin"))):
    q=db.query(models.AuditLog);total=q.count();rows=q.order_by(models.AuditLog.created_at.desc()).offset((page-1)*page_size).limit(page_size).all()
    return {"items":[{"id":x.id,"user_id":x.user_id,"action":x.action,"table_name":x.table_name,"record_id":x.record_id,"old_value":x.old_value,"new_value":x.new_value,"created_at":x.created_at} for x in rows],"total":total,"page":page,"page_size":page_size}
@admin.post("/import/tenders")
def import_tenders(file:UploadFile=File(...),db:Session=Depends(get_db),user:models.User=Depends(require_roles("admin"))):
    if not file.filename or Path(file.filename).suffix.lower()!=".csv": raise HTTPException(415,"Upload a CSV file")
    raw=file.file.read(5*1024*1024+1)
    if len(raw)>5*1024*1024: raise HTTPException(413,"CSV exceeds 5 MB")
    try: reader=csv.DictReader(io.StringIO(raw.decode("utf-8-sig")))
    except UnicodeDecodeError: raise HTTPException(422,"CSV must be UTF-8 encoded")
    required={"tender_ref","department_id","title","estimated_value"}
    if not reader.fieldnames or not required.issubset(set(reader.fieldnames)): raise HTTPException(422,"CSV needs tender_ref, department_id, title, estimated_value columns")
    created=0;errors=[]
    for line,row in enumerate(reader,start=2):
        try:
            d=db.get(models.Department,int(row["department_id"]))
            if not d: raise ValueError("unknown department_id")
            t=models.Tender(tender_ref=row["tender_ref"],department_id=d.id,title=row["title"],estimated_value=float(row["estimated_value"]),status="draft",created_by=user.id,description=row.get("description") or None,location_label=row.get("location_label") or None)
            t.bid_open_date=date.fromisoformat(row["bid_open_date"]) if row.get("bid_open_date") else None;t.bid_close_date=date.fromisoformat(row["bid_close_date"]) if row.get("bid_close_date") else None
            if row.get("latitude") and row.get("longitude"): services.set_location(t,float(row["latitude"]),float(row["longitude"]))
            db.add(t);db.flush();services.audit(db,user.id,"create","tenders",t.id,None,services.snapshot(t));db.commit();created+=1
        except Exception as exc:
            db.rollback();errors.append({"line":line,"error":str(exc)[:160]})
            if len(errors)>=50: break
    commit(db);return {"created":created,"errors":errors}

