from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func
from .admin_routes import admin
from .auth_routes import auth
from .config import settings
from .database import SessionLocal, initialize_database
from .models import User
from .prototype_seed import seed_prototype_data
from .public_routes import public
from .security import hash_password
from .spatial_seed import seed_spatial_data
from .viewer_routes import viewer

@asynccontextmanager
async def lifespan(app: FastAPI):
    initialize_database()
    if settings.load_prototype_data:
        with SessionLocal() as db:
            seed_prototype_data(db)
            seed_spatial_data(db)
    if settings.bootstrap_admin_email and settings.bootstrap_admin_password:
        with SessionLocal() as db:
            exists = db.query(User).filter(func.lower(User.email) == settings.bootstrap_admin_email.lower()).first()
            if not exists:
                db.add(User(
                    email=settings.bootstrap_admin_email.lower(),
                    password_hash=hash_password(settings.bootstrap_admin_password),
                    role="admin",
                    is_active=True,
                    token_version=1
                ))
                db.commit()
    yield

app = FastAPI(title="Road Sathi API", version="1.0.0", description="Public procurement transparency API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"]
)

app.include_router(auth, prefix="/api/v1")
app.include_router(public, prefix="/api/v1")
app.include_router(viewer, prefix="/api/v1")
app.include_router(admin, prefix="/api/v1")

@app.get("/admin/v1", include_in_schema=False)
def redirect_admin():
    return RedirectResponse(url="/admin/v1/")

@app.get("/department/v1", include_in_schema=False)
def redirect_dept():
    return RedirectResponse(url="/department/v1/")

web_dir = Path(__file__).resolve().parents[2] / "public"
app.mount("/", StaticFiles(directory=web_dir, html=True), name="web")
