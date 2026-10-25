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
    # Support prototype rows that do not include an estimate or an AOC date.
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE tenders ALTER COLUMN estimated_value DROP NOT NULL"))
        conn.execute(text("ALTER TABLE awards ALTER COLUMN aoc_date DROP NOT NULL"))
