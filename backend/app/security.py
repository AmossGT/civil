import base64, hashlib, hmac, secrets
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session
from .config import settings
from .database import get_db
from .models import User
COOKIE_NAME="opentender_session"
def hash_password(password:str)->str:
    salt=secrets.token_bytes(16); digest=hashlib.pbkdf2_hmac("sha256",password.encode(),salt,310000)
    return "pbkdf2_sha256$310000$"+base64.urlsafe_b64encode(salt).decode()+"$"+base64.urlsafe_b64encode(digest).decode()
def verify_password(password:str,stored:str)->bool:
    try:
        algorithm,rounds,salt64,digest64=stored.split("$")
        if algorithm!="pbkdf2_sha256": return False
        actual=hashlib.pbkdf2_hmac("sha256",password.encode(),base64.urlsafe_b64decode(salt64),int(rounds))
        return hmac.compare_digest(actual,base64.urlsafe_b64decode(digest64))
    except (ValueError,TypeError): return False
def _serializer(): return URLSafeTimedSerializer(settings.secret_key,salt="opentender-session-v1")
def issue_session(user_id:int)->str: return _serializer().dumps({"uid":user_id})
def current_user(request:Request,db:Session=Depends(get_db))->User:
    token=request.cookies.get(COOKIE_NAME)
    if not token: raise HTTPException(401,"Login required")
    try:
        data=_serializer().loads(token,max_age=28800); user=db.get(User,int(data["uid"]))
    except (BadSignature,SignatureExpired,ValueError,KeyError,TypeError): user=None
    if not user or not user.is_active or user.role!="admin": raise HTTPException(401,"Session expired or inactive")
    return user
def require_roles(*roles):
    def check(user:User=Depends(current_user)):
        if user.role not in roles: raise HTTPException(403,"Insufficient role")
        return user
    return check
def require_department_scope(user:User,department_id:int):
    if user.role!="admin" and user.department_id!=department_id: raise HTTPException(403,"Tender belongs to another department")
