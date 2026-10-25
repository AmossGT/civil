"""Idempotent loader for the temporary records transcribed from prototype notes."""
import json
import logging
from pathlib import Path

from sqlalchemy.orm import Session

from . import models

log = logging.getLogger(__name__)
DATA_FILE = Path(__file__).with_name("prototype_data.json")


def seed_prototype_data(db: Session) -> int:
    """Insert missing prototype tenders once; never overwrite existing records."""
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    dept_data = data["department"]
    department = db.query(models.Department).filter_by(name=dept_data["name"]).first()
    if department is None:
        department = models.Department(name=dept_data["name"], district=dept_data["district"])
        db.add(department)
        db.flush()

    imported = 0
    for record in data["tenders"]:
        if db.query(models.Tender.id).filter_by(tender_ref=record["tender_ref"]).first():
            continue
        contractor = db.query(models.Contractor).filter_by(company_name=record["contractor"]).first()
        if contractor is None:
            contractor = models.Contractor(company_name=record["contractor"])
            db.add(contractor)
            db.flush()

        extra = {key: value for key, value in record.items() if key not in {
            "tender_ref", "title", "description", "awarded_value", "contractor"
        }}
        extra.update({
            "prototype_data": True,
            "source": data["source"],
            "source_note": data["source_note"],
            "value_basis": "awarded_contract_value; not payment disbursed",
            "verification_status": "unverified_working_notes",
            "map_coordinates_status": "not_supplied",
        })
        tender = models.Tender(
            tender_ref=record["tender_ref"],
            department_id=department.id,
            title=record["title"],
            description=record["description"],
            extra_data=extra,
            estimated_value=None,
            location_label=record["division"],
            status="published",
        )
        db.add(tender)
        db.flush()
        db.add(models.Award(
            tender_id=tender.id,
            contractor_id=contractor.id,
            awarded_value=record["awarded_value"],
            aoc_date=None,
            status="pending_review",
        ))
        imported += 1

    db.commit()
    log.info("Prototype data loader inserted %d tender records", imported)
    return imported
