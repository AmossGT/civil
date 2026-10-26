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
    if not u or u.role!="admin" or not u.is_active or not verify_password(body.password,u.password_hash): raise HTTPException(401,"Invalid email or password")
    response.set_cookie(COOKIE_NAME,issue_session(u.id),httponly=True,secure=settings.cookie_secure,samesite="lax",max_age=28800,path="/api/v1")
    return {"id":u.id,"email":u.email,"role":u.role,"department_id":u.department_id}
@workflow.post("/auth/logout")
def logout(response:Response):
    response.delete_cookie(COOKIE_NAME,path="/api/v1",httponly=True,secure=settings.cookie_secure,samesite="lax"); return {"ok":True}
@workflow.get("/auth/me")
def me(user:models.User=Depends(current_user)): return {"id":user.id,"email":user.email,"role":user.role,"department_id":user.department_id}
