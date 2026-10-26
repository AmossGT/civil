from datetime import datetime, timezone
from sqlalchemy import cast, func
from sqlalchemy.orm import Session, joinedload
from geoalchemy2 import Geometry, WKTElement
from . import models
from .config import settings

def audit(db:Session,user_id:int|None,action:str,table:str,record_id:int,old:dict|None,new:dict|None):
    db.add(models.AuditLog(user_id=user_id,action=action,table_name=table,record_id=record_id,old_value=old,new_value=new))
def snapshot(t:models.Tender)->dict:
    return {"tender_ref":t.tender_ref,"title":t.title,"status":t.status,"estimated_value":float(t.estimated_value) if t.estimated_value is not None else None,"bid_open_date":str(t.bid_open_date) if t.bid_open_date else None,"bid_close_date":str(t.bid_close_date) if t.bid_close_date else None,"location_label":t.location_label,"extra_data":t.extra_data}
def set_location(t:models.Tender,lat:float|None,lng:float|None):
    if lat is None and lng is None: t.location=None
    elif lat is None or lng is None: raise ValueError("Latitude and longitude must be supplied together")
    else: t.location=WKTElement(f"POINT({lng} {lat})",srid=4326)
def detail_query(db:Session):
    return db.query(models.Tender).options(joinedload(models.Tender.department).joinedload(models.Department.officers),joinedload(models.Tender.award).joinedload(models.Award.contractor).joinedload(models.Contractor.contacts))
def public_tender(t:models.Tender,db:Session)->dict:
    point=db.query(func.ST_Y(cast(t.location,Geometry)),func.ST_X(cast(t.location,Geometry))).filter(models.Tender.id==t.id).first() if t.location is not None else None
    award=None
    prototype_data=bool((t.extra_data or {}).get("prototype_data"))
    if t.award and (t.award.status=="verified" or (prototype_data and t.award.status=="pending_review")):
        c=t.award.contractor
        award={"awarded_value":float(t.award.awarded_value),"aoc_date":t.award.aoc_date,"provisional":t.award.status!="verified","contractor":{"id":c.id,"company_name":c.company_name,"registration_no":c.registration_no,"contacts":[{"id":x.id,"name":x.name,"role":x.role,"office_phone":x.office_phone} for x in c.contacts]}}
    return {"tender_ref":t.tender_ref,"title":t.title,"description":t.description,"extra_data":t.extra_data,"prototype_data":prototype_data,"status":t.status,"estimated_value":float(t.estimated_value) if t.estimated_value is not None else None,"bid_open_date":t.bid_open_date,"bid_close_date":t.bid_close_date,"location":{"lat":float(point[0]),"lng":float(point[1])} if point and point[0] is not None else None,"location_label":t.location_label,"department":{"id":t.department.id,"name":t.department.name,"district":t.department.district,"officers":[{"id":o.id,"name":o.name,"designation":o.designation,"office_phone":o.office_phone} for o in t.department.officers]},"award":award,"documents":[public_document(t.tender_ref,d) for d in t.documents],"work_order_url":f"/api/v1/tenders/{t.tender_ref}/work-order" if t.work_order_path else None}
def visible_tenders(db:Session): return db.query(models.Tender).filter(models.Tender.status.in_(["published","awarded"]))
def apply_filters(query,q=None,department_id=None,contractor_id=None,min_value=None,max_value=None,opens_after=None,closes_before=None):
    if q: query=query.filter(models.Tender.title.ilike(f"%{q}%")|models.Tender.tender_ref.ilike(f"%{q}%"))
    if department_id is not None: query=query.filter(models.Tender.department_id==department_id)
    if contractor_id is not None: query=query.join(models.Award).filter(models.Award.contractor_id==contractor_id,models.Award.status=="verified")
    if min_value is not None: query=query.filter(models.Tender.estimated_value>=min_value)
    if max_value is not None: query=query.filter(models.Tender.estimated_value<=max_value)
    if opens_after: query=query.filter(models.Tender.bid_open_date>=opens_after)
    if closes_before: query=query.filter(models.Tender.bid_close_date<=closes_before)
    return query
def safe_upload_path(name:str):
    target=(settings.upload_dir/name).resolve(); root=settings.upload_dir.resolve()
    return target if target.is_relative_to(root) else None

def public_document(ref:str,document:models.TenderDocument)->dict:
    return {"id":document.id,"document_type":document.document_type,"label":document.label,"filename":document.source_filename,"content_type":document.content_type,"download_url":f"/api/v1/tenders/{ref}/documents/{document.id}"}


