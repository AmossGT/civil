from datetime import date
from pydantic import BaseModel, ConfigDict, EmailStr, Field
class ContactOut(BaseModel):
    model_config=ConfigDict(from_attributes=True)
    id:int; name:str; role:str; office_phone:str|None=None
class OfficerOut(BaseModel):
    model_config=ConfigDict(from_attributes=True)
    id:int; name:str; designation:str; office_phone:str|None=None
class DepartmentOut(BaseModel):
    id:int; name:str; district:str|None=None; officers:list[OfficerOut]=[]
class ContractorOut(BaseModel):
    id:int; company_name:str; registration_no:str|None=None; contacts:list[ContactOut]=[]
class AwardOut(BaseModel):
    awarded_value:float; aoc_date:date|None=None; contractor:ContractorOut
class TenderOut(BaseModel):
    tender_ref:str; title:str; description:str|None=None; extra_data:dict=Field(default_factory=dict); status:str; estimated_value:float|None=None
    bid_open_date:date|None=None; bid_close_date:date|None=None; location:dict|None=None
    location_label:str|None=None; department:DepartmentOut; award:AwardOut|None=None; work_order_url:str|None=None
class TenderCreate(BaseModel):
    tender_ref:str=Field(min_length=3,max_length=100); title:str=Field(min_length=5,max_length=400)
    description:str|None=None; extra_data:dict=Field(default_factory=dict); estimated_value:float=Field(gt=0); bid_open_date:date|None=None; bid_close_date:date|None=None
    latitude:float|None=Field(default=None,ge=-90,le=90); longitude:float|None=Field(default=None,ge=-180,le=180); location_label:str|None=None
class TenderPatch(BaseModel):
    title:str|None=Field(default=None,min_length=5,max_length=400); description:str|None=None; extra_data:dict|None=None
    estimated_value:float|None=Field(default=None,gt=0); bid_open_date:date|None=None; bid_close_date:date|None=None
    latitude:float|None=Field(default=None,ge=-90,le=90); longitude:float|None=Field(default=None,ge=-180,le=180); location_label:str|None=None
class AwardCreate(BaseModel): contractor_id:int; awarded_value:float=Field(gt=0); aoc_date:date
class LoginIn(BaseModel): email:EmailStr; password:str=Field(min_length=1,max_length=256)
class DepartmentCreate(BaseModel): name:str=Field(min_length=2,max_length=160); district:str|None=None
class OfficerCreate(BaseModel): name:str; designation:str; office_phone:str|None=None
class ContractorCreate(BaseModel): company_name:str; registration_no:str|None=None
class ContactCreate(BaseModel): name:str; role:str; office_phone:str|None=None
class RejectIn(BaseModel): comment:str=Field(min_length=3,max_length=2000)
class UserCreate(BaseModel):
    email:EmailStr
    password:str=Field(min_length=12,max_length=256)
    role:str=Field(pattern="^admin$")
    department_id:int|None=None



