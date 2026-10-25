import secrets
from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from . import models, schemas, services
from .config import settings
from .database import get_db
from .security import COOKIE_NAME, current_user, hash_password, issue_session, require_department_scope, require_roles, verify_password
workflow=APIRouter()
def commit(db):
    try: db.commit()
    except IntegrityError:
        db.rollback(); raise HTTPException(409,"A record with those unique values already exists")
def get_tender(db,ref):
    t=services.detail_query(db).filter_by(tender_ref=ref).first()
    if not t: raise HTTPException(404,"Tender not found")
    return t
@workflow.post("/auth/login")
def login(body:schemas.LoginIn,response:Response,db:Session=Depends(get_db)):
    u=db.query(models.User).filter(func.lower(models.User.email)==body.email.lower()).first()
    if not u or not u.is_active or not verify_password(body.password,u.password_hash): raise HTTPException(401,"Invalid email or password")
    response.set_cookie(COOKIE_NAME,issue_session(u.id),httponly=True,secure=settings.cookie_secure,samesite="lax",max_age=28800,path="/api/v1")
    return {"id":u.id,"email":u.email,"role":u.role,"department_id":u.department_id}
@workflow.post("/auth/logout")
def logout(response:Response):
    response.delete_cookie(COOKIE_NAME,path="/api/v1",httponly=True,secure=settings.cookie_secure,samesite="lax"); return {"ok":True}
@workflow.get("/auth/me")
def me(user:models.User=Depends(current_user)): return {"id":user.id,"email":user.email,"role":user.role,"department_id":user.department_id}
@workflow.get("/my/tenders")
def my_tenders(db:Session=Depends(get_db),user:models.User=Depends(require_roles("officer"))):
    rows=db.query(models.Tender).filter_by(department_id=user.department_id,created_by=user.id).order_by(models.Tender.updated_at.desc()).limit(100).all()
    return {"items":[{"tender_ref":t.tender_ref,"title":t.title,"status":t.status,"estimated_value":float(t.estimated_value),"rejection_comment":t.rejection_comment} for t in rows]}
@workflow.post("/tenders",status_code=201)
def create_tender(body:schemas.TenderCreate,db:Session=Depends(get_db),user:models.User=Depends(require_roles("officer"))):
    if not user.department_id: raise HTTPException(403,"Officer has no assigned department")
    t=models.Tender(tender_ref=body.tender_ref,title=body.title,description=body.description,extra_data=body.extra_data,estimated_value=body.estimated_value,bid_open_date=body.bid_open_date,bid_close_date=body.bid_close_date,department_id=user.department_id,location_label=body.location_label,status="draft",created_by=user.id)
    try: services.set_location(t,body.latitude,body.longitude)
    except ValueError as e: raise HTTPException(422,str(e))
    db.add(t);db.flush();services.audit(db,user.id,"create","tenders",t.id,None,services.snapshot(t));commit(db)
    return {"tender_ref":t.tender_ref,"status":t.status}
@workflow.patch("/tenders/{ref}")
def update_tender(ref:str,body:schemas.TenderPatch,db:Session=Depends(get_db),user:models.User=Depends(require_roles("officer"))):
    t=get_tender(db,ref);require_department_scope(user,t.department_id)
    if t.status not in ("draft","rejected"): raise HTTPException(409,"Only draft or rejected tenders can be edited")
    old=services.snapshot(t);data=body.model_dump(exclude_unset=True);lat=data.pop("latitude",None);lng=data.pop("longitude",None)
    for key,value in data.items(): setattr(t,key,value)
    if "latitude" in body.model_fields_set or "longitude" in body.model_fields_set:
        try: services.set_location(t,lat,lng)
        except ValueError as e: raise HTTPException(422,str(e))
    t.status="draft";t.rejection_comment=None;services.audit(db,user.id,"update","tenders",t.id,old,services.snapshot(t));commit(db)
    return {"tender_ref":ref,"status":t.status}
@workflow.post("/tenders/{ref}/submit")
def submit_tender(ref:str,db:Session=Depends(get_db),user:models.User=Depends(require_roles("officer"))):
    t=get_tender(db,ref);require_department_scope(user,t.department_id)
    if t.status not in ("draft","rejected"): raise HTTPException(409,"Tender is not in a submittable state")
    old=services.snapshot(t);t.status="pending_review";t.rejection_comment=None;services.audit(db,user.id,"submit","tenders",t.id,old,services.snapshot(t));commit(db)
    return {"tender_ref":ref,"status":t.status}
@workflow.post("/tenders/{ref}/work-order",status_code=201)
def upload_work_order(ref:str,file:UploadFile=File(...),db:Session=Depends(get_db),user:models.User=Depends(require_roles("officer"))):
    t=get_tender(db,ref);require_department_scope(user,t.department_id)
    if t.status not in ("draft","rejected","published","awarded"): raise HTTPException(409,"Work order cannot be changed in this state")
    if file.content_type!="application/pdf": raise HTTPException(415,"Only PDF files are accepted")
    data=file.file.read(settings.max_upload_bytes+1)
    if len(data)>settings.max_upload_bytes: raise HTTPException(413,"PDF exceeds the size limit")
    if not data.startswith(b"%PDF-"): raise HTTPException(415,"File content is not a PDF")
    settings.upload_dir.mkdir(parents=True,exist_ok=True);name=secrets.token_hex(20)+".pdf";(settings.upload_dir/name).write_bytes(data)
    old=t.work_order_path;t.work_order_path=name;services.audit(db,user.id,"update","tenders",t.id,{"work_order_path":old},{"work_order_path":name});commit(db)
    return {"work_order_url":f"/api/v1/tenders/{ref}/work-order"}
@workflow.post("/tenders/{ref}/award",status_code=201)
def add_award(ref:str,body:schemas.AwardCreate,db:Session=Depends(get_db),user:models.User=Depends(require_roles("officer"))):
    t=get_tender(db,ref);require_department_scope(user,t.department_id)
    if t.status!="published": raise HTTPException(409,"Only a published tender can receive an award")
    if not db.get(models.Contractor,body.contractor_id): raise HTTPException(404,"Contractor not found")
    if t.award and t.award.status!="rejected": raise HTTPException(409,"An award record already exists")
    if t.award:
        a=t.award; old={"status":a.status,"awarded_value":float(a.awarded_value),"contractor_id":a.contractor_id}
        a.contractor_id=body.contractor_id; a.awarded_value=body.awarded_value; a.aoc_date=body.aoc_date; a.status="pending_review"; action="update"
    else:
        a=models.Award(tender_id=t.id,contractor_id=body.contractor_id,awarded_value=body.awarded_value,aoc_date=body.aoc_date,status="pending_review"); db.add(a); db.flush(); old=None; action="create"
    services.audit(db,user.id,action,"awards",a.id,old,{"tender_ref":ref,"contractor_id":a.contractor_id,"awarded_value":float(a.awarded_value),"aoc_date":str(a.aoc_date),"status":a.status}); commit(db)
    return {"tender_ref":ref,"award_status":a.status}




