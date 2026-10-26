import hashlib
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session
from . import models, schemas
from .config import settings
from .database import get_db
from .security import (
    COOKIE_NAME,
    create_access_token,
    create_refresh_token,
    rate_limit,
    require_auth,
    verify_password,
)

auth = APIRouter(prefix="/auth", tags=["Authentication"])

class RefreshIn(BaseModel):
    refresh_token: str

@auth.post("/login", response_model=schemas.TokenOut)
def login(body: schemas.LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    client_ip = request.client.host if request.client else "unknown"
    rate_limit(f"login:{client_ip}", max_requests=10, window_seconds=60)

    u = db.query(models.User).filter(func.lower(models.User.email) == body.email.lower()).first()
    if not u or not u.is_active or not verify_password(body.password, u.password_hash):
        raise HTTPException(401, "Invalid email or password")

    access_token = create_access_token(u)
    refresh_token = create_refresh_token(db, u)

    response.set_cookie(
        COOKIE_NAME,
        access_token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=settings.access_token_expire_minutes * 60,
        path="/api/v1"
    )

    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "user": {
            "id": u.id,
            "email": u.email,
            "role": u.role,
            "department_id": u.department_id
        }
    }

@auth.post("/refresh", response_model=schemas.TokenOut)
def refresh(body: RefreshIn, response: Response, db: Session = Depends(get_db)):
    token_hash = hashlib.sha256(body.refresh_token.encode()).hexdigest()
    record = db.query(models.RefreshToken).filter_by(token_hash=token_hash, revoked=False).first()
    if not record or record.expires_at < datetime.now(timezone.utc):
        raise HTTPException(401, "Invalid or expired refresh token")

    user = db.get(models.User, record.user_id)
    if not user or not user.is_active:
        raise HTTPException(401, "User inactive or not found")

    # Rotate refresh token
    record.revoked = True
    new_access_token = create_access_token(user)
    new_refresh_token = create_refresh_token(db, user)

    response.set_cookie(
        COOKIE_NAME,
        new_access_token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=settings.access_token_expire_minutes * 60,
        path="/api/v1"
    )

    return {
        "access_token": new_access_token,
        "refresh_token": new_refresh_token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "email": user.email,
            "role": user.role,
            "department_id": user.department_id
        }
    }

@auth.post("/logout")
def logout(response: Response, user: models.User = Depends(require_auth), db: Session = Depends(get_db)):
    user.token_version = getattr(user, "token_version", 1) + 1
    db.query(models.RefreshToken).filter_by(user_id=user.id, revoked=False).update({"revoked": True})
    db.commit()

    response.delete_cookie(COOKIE_NAME, path="/api/v1", httponly=True, secure=settings.cookie_secure, samesite="lax")
    return {"ok": True}

@auth.get("/me")
def me(user: models.User = Depends(require_auth)):
    return {
        "id": user.id,
        "email": user.email,
        "role": user.role,
        "department_id": user.department_id
    }
