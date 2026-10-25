from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from .config import settings
class Base(DeclarativeBase): pass
engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
def get_db():
    db=SessionLocal()
    try: yield db
    finally: db.close()
def initialize_database():
    with engine.begin() as conn: conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
    from . import models
    Base.metadata.create_all(bind=engine)
