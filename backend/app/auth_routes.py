import hashlib
import hmac
import secrets
import smtplib
import ssl
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import func, text
from sqlalchemy.orm import Session
from . import models, schemas
from .config import settings
from .database import get_db
from .security import (
    COOKIE_NAME,
    create_access_token,
    create_refresh_token,
    hash_password,
    password_needs_rehash,
    rate_limit,
    require_auth,
    verify_password,
)

auth = APIRouter(prefix="/auth", tags=["Authentication"])

def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"

def _require_strong_password(password: str):
    if len(password) < 8 or not any(c.isupper() for c in password) or not any(c.islower() for c in password) or not any(c.isdigit() for c in password) or not any(not c.isalnum() for c in password):
        raise HTTPException(422, "Password must be at least 8 characters and include uppercase, lowercase, number, and symbol characters.")

def _admin_exists(db: Session) -> bool:
    return db.query(models.User.id).filter(models.User.role == "admin").first() is not None

def _otp_digest(email: str, code: str) -> str:
    payload = f"admin-setup:{email}:{code}".encode()
    return hmac.new(settings.secret_key.encode(), payload, hashlib.sha256).hexdigest()

def _send_admin_setup_code(email: str, code: str):
    if not settings.smtp_host or not settings.smtp_from_email:
        raise RuntimeError("Email delivery is not configured. Set SMTP_HOST and SMTP_FROM_EMAIL.")
    message = EmailMessage()
    message["Subject"] = "RoadSathi first administrator verification code"
    message["From"] = settings.smtp_from_email
    message["To"] = email
    message.set_content(f"Your RoadSathi administrator setup verification code is {code}. It expires in 10 minutes. If you did not request this, ignore this message.")
    smtp_factory = smtplib.SMTP_SSL if settings.smtp_use_tls and settings.smtp_port == 465 else smtplib.SMTP
    smtp_options = {"context": ssl.create_default_context()} if smtp_factory is smtplib.SMTP_SSL else {}
    with smtp_factory(settings.smtp_host, settings.smtp_port, timeout=15, **smtp_options) as smtp:
        if settings.smtp_use_tls and settings.smtp_port != 465:
            smtp.starttls(context=ssl.create_default_context())
        if settings.smtp_username:
            smtp.login(settings.smtp_username, settings.smtp_password or "")
        smtp.send_message(message)

def _session_response(user: models.User, response: Response, db: Session):
    access_token = create_access_token(user)
    refresh_token = create_refresh_token(db, user)
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
        "user": {"id": user.id, "email": user.email, "full_name": user.full_name, "role": user.role, "department_id": user.department_id}
    }

@auth.get("/admin-setup/status")
def admin_setup_status(db: Session = Depends(get_db)):
    setup_available = not _admin_exists(db)
    return {
        "setup_available": setup_available,
        "email_delivery_ready": bool(settings.smtp_host and settings.smtp_from_email),
    }

@auth.post("/admin-setup/start", status_code=202)
def start_admin_setup(body: schemas.AdminSetupStart, request: Request, db: Session = Depends(get_db)):
    client_ip = _client_ip(request)
    email = body.email.lower()
    rate_limit(f"admin-setup-ip:{client_ip}", max_requests=5, window_seconds=3600)
    rate_limit(f"admin-setup-email:{email}", max_requests=3, window_seconds=3600)
    if _admin_exists(db):
        raise HTTPException(409, "First-admin setup is closed because an administrator account already exists.")
    _require_strong_password(body.password)

    now = datetime.now(timezone.utc)
    db.query(models.PendingAdminSetup).filter(models.PendingAdminSetup.expires_at < now).delete(synchronize_session=False)
    current_pending = db.query(models.PendingAdminSetup).filter_by(email=email).first()
    if current_pending:
        raise HTTPException(409, "A first-admin setup code is already pending for this email. Wait for it to expire before requesting another.")
    code = f"{secrets.randbelow(1_000_000):06d}"
    values = {
        "full_name": body.full_name.strip(),
        "phone": body.phone.strip() if body.phone else None,
        "password_hash": hash_password(body.password),
        "otp_hash": _otp_digest(email, code),
        "expires_at": now.replace(microsecond=0) + timedelta(minutes=10),
        "failed_attempts": 0,
    }
    pending = models.PendingAdminSetup(email=email, **values)
    db.add(pending)
    db.commit()
    try:
        _send_admin_setup_code(email, code)
    except Exception as exc:
        db.delete(pending)
        db.commit()
        raise HTTPException(503, str(exc)) from exc
    return {"message": "Verification code sent. Enter it to finish creating the first administrator account."}

@auth.post("/admin-setup/verify", response_model=schemas.TokenOut)
def verify_admin_setup(body: schemas.AdminSetupVerify, request: Request, response: Response, db: Session = Depends(get_db)):
    email = body.email.lower()
    rate_limit(f"admin-setup-verify-ip:{_client_ip(request)}", max_requests=10, window_seconds=300)
    pending = db.query(models.PendingAdminSetup).filter_by(email=email).first()
    if not pending:
        raise HTTPException(400, "Setup request not found or expired. Start the setup again.")
    if pending.expires_at < datetime.now(timezone.utc):
        db.delete(pending)
        db.commit()
        raise HTTPException(400, "Verification code expired. Start the setup again.")
    if not hmac.compare_digest(pending.otp_hash, _otp_digest(email, body.code)):
        pending.failed_attempts += 1
        if pending.failed_attempts >= 5:
            db.delete(pending)
        db.commit()
        raise HTTPException(400, "Verification code is invalid.")

    # Serialize first-admin creation so two valid setup requests cannot both succeed.
    db.execute(text("SELECT pg_advisory_xact_lock(724920261104)"))
    if _admin_exists(db):
        db.delete(pending)
        db.commit()
        raise HTTPException(409, "First-admin setup has already been completed.")
    user = models.User(
        email=email,
        full_name=pending.full_name,
        phone=pending.phone,
        password_hash=pending.password_hash,
        role="admin",
        is_active=True,
        email_verified=True,
        token_version=1,
    )
    db.add(user)
    db.delete(pending)
    db.commit()
    return _session_response(user, response, db)

class RefreshIn(BaseModel):
    refresh_token: str

@auth.post("/login", response_model=schemas.TokenOut)
def login(body: schemas.LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    client_ip = _client_ip(request)
    rate_limit(f"login:{client_ip}", max_requests=10, window_seconds=60)

    u = db.query(models.User).filter(func.lower(models.User.email) == body.email.lower()).first()
    if not u or not u.is_active or not u.email_verified or not verify_password(body.password, u.password_hash):
        raise HTTPException(401, "Invalid email or password")
    if password_needs_rehash(u.password_hash):
        u.password_hash = hash_password(body.password)
        db.commit()
    return _session_response(u, response, db)

@auth.post("/admin/login", response_model=schemas.TokenOut)
def admin_login(body: schemas.LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    rate_limit(f"admin-login:{_client_ip(request)}", max_requests=8, window_seconds=60)
    user = db.query(models.User).filter(func.lower(models.User.email) == body.email.lower()).first()
    if not user or user.role != "admin" or not user.is_active or not user.email_verified or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "Invalid administrator email or password")
    if password_needs_rehash(user.password_hash):
        user.password_hash = hash_password(body.password)
        db.commit()
    return _session_response(user, response, db)

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
