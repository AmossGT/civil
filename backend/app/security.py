import base64, hashlib, hmac, json, secrets, time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session
from .config import settings
from .database import get_db
from .models import RefreshToken, User

COOKIE_NAME = "opentender_session"

_rate_buckets: dict[str, list[float]] = defaultdict(list)

def rate_limit(key: str, max_requests: int = 5, window_seconds: int = 60):
    now = time.time()
    bucket = _rate_buckets[key]
    _rate_buckets[key] = [t for t in bucket if now - t < window_seconds]
    if len(_rate_buckets[key]) >= max_requests:
        raise HTTPException(429, "Too many requests. Please try again later.")
    _rate_buckets[key].append(now)

def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 310000)
    return "pbkdf2_sha256$310000$" + base64.urlsafe_b64encode(salt).decode() + "$" + base64.urlsafe_b64encode(digest).decode()

def verify_password(password: str, stored: str) -> bool:
    try:
        algorithm, rounds, salt64, digest64 = stored.split("$")
        if algorithm != "pbkdf2_sha256": return False
        actual = hashlib.pbkdf2_hmac("sha256", password.encode(), base64.urlsafe_b64decode(salt64), int(rounds))
        return hmac.compare_digest(actual, base64.urlsafe_b64decode(digest64))
    except (ValueError, TypeError):
        return False

def create_access_token(user: User) -> str:
    now = int(time.time())
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "sub": user.id,
        "email": user.email,
        "role": user.role,
        "department_id": user.department_id,
        "tv": getattr(user, "token_version", 1),
        "iat": now,
        "exp": now + (settings.access_token_expire_minutes * 60),
    }
    def b64url(b: bytes) -> str:
        return base64.urlsafe_b64encode(b).rstrip(b'=').decode('ascii')
    h_str = b64url(json.dumps(header, separators=(',', ':')).encode('utf-8'))
    p_str = b64url(json.dumps(payload, separators=(',', ':')).encode('utf-8'))
    sig = hmac.new(settings.secret_key.encode('utf-8'), f"{h_str}.{p_str}".encode('utf-8'), hashlib.sha256).digest()
    return f"{h_str}.{p_str}.{b64url(sig)}"

def decode_access_token(token: str) -> dict:
    parts = token.split('.')
    if len(parts) != 3:
        raise ValueError("Invalid token format")
    h_str, p_str, s_str = parts
    def b64url_decode(s: str) -> bytes:
        rem = len(s) % 4
        if rem > 0:
            s += '=' * (4 - rem)
        return base64.urlsafe_b64decode(s.encode('ascii'))
    expected_sig = hmac.new(settings.secret_key.encode('utf-8'), f"{h_str}.{p_str}".encode('utf-8'), hashlib.sha256).digest()
    actual_sig = b64url_decode(s_str)
    if not hmac.compare_digest(expected_sig, actual_sig):
        raise ValueError("Invalid signature")
    payload = json.loads(b64url_decode(p_str).decode('utf-8'))
    if payload.get("exp") and time.time() > payload["exp"]:
        raise ValueError("Token expired")
    return payload

def create_refresh_token(db: Session, user: User) -> str:
    raw = secrets.token_urlsafe(48)
    token_hash = hashlib.sha256(raw.encode()).hexdigest()
    expires_at = datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days)
    db.add(RefreshToken(user_id=user.id, token_hash=token_hash, expires_at=expires_at))
    db.commit()
    return raw

def get_current_user(request: Request, db: Session = Depends(get_db)) -> User | None:
    token = None
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header[7:].strip()
    elif request.cookies.get(COOKIE_NAME):
        token = request.cookies.get(COOKIE_NAME)
    if not token:
        return None
    try:
        data = decode_access_token(token)
    except Exception:
        return None
    user = db.get(User, int(data["sub"]))
    if not user or not user.is_active:
        return None
    if getattr(user, "token_version", 1) != data.get("tv"):
        return None
    return user

def require_auth(user: User | None = Depends(get_current_user)) -> User:
    if not user:
        raise HTTPException(401, "Authentication required")
    return user

def require_roles(*roles: str):
    def check(user: User = Depends(require_auth)):
        if user.role not in roles:
            raise HTTPException(403, "Insufficient permissions")
        return user
    return check
