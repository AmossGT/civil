from datetime import date, datetime, timezone
from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, Integer, JSON, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from geoalchemy2 import Geography
from .database import Base

def utcnow(): return datetime.now(timezone.utc)

class Department(Base):
    __tablename__="departments"
    id: Mapped[int]=mapped_column(primary_key=True)
    name: Mapped[str]=mapped_column(String(160),unique=True,index=True)
    district: Mapped[str|None]=mapped_column(String(120))
    officers: Mapped[list['Officer']]=relationship(back_populates="department",cascade="all, delete-orphan")
    tenders: Mapped[list['Tender']]=relationship(back_populates="department")

class Officer(Base):
    __tablename__="officers"
    id: Mapped[int]=mapped_column(primary_key=True)
    department_id: Mapped[int]=mapped_column(ForeignKey("departments.id",ondelete="CASCADE"),index=True)
    name: Mapped[str]=mapped_column(String(160))
    designation: Mapped[str]=mapped_column(String(160))
    office_phone: Mapped[str|None]=mapped_column(String(40))
    department: Mapped[Department]=relationship(back_populates="officers")

class Contractor(Base):
    __tablename__="contractors"
    id: Mapped[int]=mapped_column(primary_key=True)
    company_name: Mapped[str]=mapped_column(String(200),index=True)
    registration_no: Mapped[str|None]=mapped_column(String(100),unique=True)
    contacts: Mapped[list['ContractorContact']]=relationship(back_populates="contractor",cascade="all, delete-orphan")
    awards: Mapped[list['Award']]=relationship(back_populates="contractor")

class ContractorContact(Base):
    __tablename__="contractor_contacts"
    id: Mapped[int]=mapped_column(primary_key=True)
    contractor_id: Mapped[int]=mapped_column(ForeignKey("contractors.id",ondelete="CASCADE"),index=True)
    name: Mapped[str]=mapped_column(String(160))
    role: Mapped[str]=mapped_column(String(120))
    office_phone: Mapped[str|None]=mapped_column(String(40))
    contractor: Mapped[Contractor]=relationship(back_populates="contacts")

class User(Base):
    __tablename__="users"
    id: Mapped[int]=mapped_column(primary_key=True)
    email: Mapped[str]=mapped_column(String(254),unique=True,index=True)
    password_hash: Mapped[str]=mapped_column(String(300))
    role: Mapped[str]=mapped_column(String(30))  # "admin" or "department_viewer"
    department_id: Mapped[int|None]=mapped_column(ForeignKey("departments.id",ondelete="SET NULL"))
    token_version: Mapped[int]=mapped_column(Integer,default=1)
    is_active: Mapped[bool]=mapped_column(Boolean,default=True)

class RefreshToken(Base):
    __tablename__="refresh_tokens"
    id: Mapped[int]=mapped_column(primary_key=True)
    user_id: Mapped[int]=mapped_column(ForeignKey("users.id",ondelete="CASCADE"),index=True)
    token_hash: Mapped[str]=mapped_column(String(128),unique=True,index=True)
    expires_at: Mapped[datetime]=mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime]=mapped_column(DateTime(timezone=True),default=utcnow)
    revoked: Mapped[bool]=mapped_column(Boolean,default=False)

class Tender(Base):
    __tablename__="tenders"
    __table_args__=(Index("ix_tenders_location_gist","location",postgresql_using="gist"),)
    id: Mapped[int]=mapped_column(primary_key=True)
    tender_ref: Mapped[str]=mapped_column(String(100),unique=True,index=True)
    department_id: Mapped[int]=mapped_column(ForeignKey("departments.id"),index=True)
    title: Mapped[str]=mapped_column(String(400),index=True)
    description: Mapped[str|None]=mapped_column(Text)
    extra_data: Mapped[dict]=mapped_column(JSON,default=dict)
    estimated_value: Mapped[float|None]=mapped_column(Numeric(16,2),nullable=True)
    bid_open_date: Mapped[date|None]=mapped_column(Date)
    bid_close_date: Mapped[date|None]=mapped_column(Date)
    location=mapped_column(Geography(geometry_type="POINT",srid=4326),nullable=True)
    location_label: Mapped[str|None]=mapped_column(String(240))
    work_order_path: Mapped[str|None]=mapped_column(String(500))
    status: Mapped[str]=mapped_column(String(30),default="draft",index=True)
    rejection_comment: Mapped[str|None]=mapped_column(Text)
    created_by: Mapped[int|None]=mapped_column(ForeignKey("users.id"))
    verified_by: Mapped[int|None]=mapped_column(ForeignKey("users.id"))
    verified_at: Mapped[datetime|None]=mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime]=mapped_column(DateTime(timezone=True),default=utcnow)
    updated_at: Mapped[datetime]=mapped_column(DateTime(timezone=True),default=utcnow,onupdate=utcnow)
    department: Mapped[Department]=relationship(back_populates="tenders")
    award: Mapped['Award|None']=relationship(back_populates="tender",uselist=False,cascade="all, delete-orphan")
    documents: Mapped[list['TenderDocument']]=relationship(back_populates="tender",cascade="all, delete-orphan")
    spatial_features: Mapped[list['TenderSpatialFeature']]=relationship(back_populates="tender",cascade="all, delete-orphan")

class Award(Base):
    __tablename__="awards"
    __table_args__=(UniqueConstraint("tender_id",name="uq_awards_tender_id"),)
    id: Mapped[int]=mapped_column(primary_key=True)
    tender_id: Mapped[int]=mapped_column(ForeignKey("tenders.id",ondelete="CASCADE"),index=True)
    contractor_id: Mapped[int]=mapped_column(ForeignKey("contractors.id"),index=True)
    awarded_value: Mapped[float]=mapped_column(Numeric(16,2))
    aoc_date: Mapped[date|None]=mapped_column(Date,nullable=True)
    status: Mapped[str]=mapped_column(String(24),default="pending_review")
    verified_by: Mapped[int|None]=mapped_column(ForeignKey("users.id"))
    verified_at: Mapped[datetime|None]=mapped_column(DateTime(timezone=True))
    tender: Mapped[Tender]=relationship(back_populates="award")
    contractor: Mapped[Contractor]=relationship(back_populates="awards")

class TenderDocument(Base):
    __tablename__="tender_documents"
    id: Mapped[int]=mapped_column(primary_key=True)
    tender_id: Mapped[int]=mapped_column(ForeignKey("tenders.id",ondelete="CASCADE"),index=True)
    document_type: Mapped[str]=mapped_column(String(50),index=True)
    label: Mapped[str]=mapped_column(String(200))
    source_filename: Mapped[str]=mapped_column(String(255))
    storage_name: Mapped[str]=mapped_column(String(500),unique=True)
    content_type: Mapped[str]=mapped_column(String(100),default="application/pdf")
    extra_data: Mapped[dict]=mapped_column(JSON,default=dict)
    uploaded_by: Mapped[int|None]=mapped_column(ForeignKey("users.id",ondelete="SET NULL"))
    created_at: Mapped[datetime]=mapped_column(DateTime(timezone=True),default=utcnow)
    tender: Mapped[Tender]=relationship(back_populates="documents")

class TenderSpatialFeature(Base):
    __tablename__="tender_spatial_features"
    __table_args__=(
        UniqueConstraint("tender_id","source_filename","source_feature_id",name="uq_tender_spatial_source_feature"),
        Index("ix_tender_spatial_geometry_gist","geometry",postgresql_using="gist"),
    )
    id: Mapped[int]=mapped_column(primary_key=True)
    tender_id: Mapped[int]=mapped_column(ForeignKey("tenders.id",ondelete="CASCADE"),index=True)
    source_filename: Mapped[str]=mapped_column(String(255))
    source_feature_id: Mapped[str]=mapped_column(String(100))
    feature_name: Mapped[str]=mapped_column(String(400))
    geometry_type: Mapped[str]=mapped_column(String(40))
    geometry=mapped_column(Geography(geometry_type="GEOMETRY",srid=4326),nullable=False)
    properties: Mapped[dict]=mapped_column(JSON,default=dict)
    tender: Mapped[Tender]=relationship(back_populates="spatial_features")

class AuditLog(Base):
    __tablename__="audit_log"
    id: Mapped[int]=mapped_column(primary_key=True)
    user_id: Mapped[int|None]=mapped_column(ForeignKey("users.id"),index=True)
    action: Mapped[str]=mapped_column(String(40))
    table_name: Mapped[str]=mapped_column(String(80),index=True)
    record_id: Mapped[int]=mapped_column(Integer,index=True)
    old_value: Mapped[dict|None]=mapped_column(JSON)
    new_value: Mapped[dict|None]=mapped_column(JSON)
    created_at: Mapped[datetime]=mapped_column(DateTime(timezone=True),default=utcnow,index=True)
