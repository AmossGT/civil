"""Idempotent loader for the temporary records transcribed from prototype notes."""
import json
import logging
from pathlib import Path
import shutil

from sqlalchemy.orm import Session

from . import models
from .config import settings

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
        tender = db.query(models.Tender).filter_by(tender_ref=record["tender_ref"]).first()
        if tender is None:
            contractor = db.query(models.Contractor).filter_by(company_name=record["contractor"]).first()
            if contractor is None:
                contractor = models.Contractor(company_name=record["contractor"])
                db.add(contractor)
                db.flush()

        extra = {key: value for key, value in record.items() if key not in {
            "tender_ref", "title", "description", "awarded_value", "contractor", "documents"
        }}
        contact = record.get("grievance_contact") or record.get("project_office_contact")
        if contact:
            extra["grievance_contact"] = contact
        extra.update({
            "prototype_data": True,
            "source": data["source"],
            "source_note": data["source_note"],
            "value_basis": "awarded_contract_value; not payment disbursed",
            "verification_status": "unverified_working_notes",
            "map_coordinates_status": "not_supplied",
        })
        if tender is None:
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

        if contact:
            existing_extra = dict(tender.extra_data or {})
            if existing_extra.get("grievance_contact") != contact:
                existing_extra["grievance_contact"] = contact
                tender.extra_data = existing_extra

        for item in record.get("documents", []):
            if db.query(models.TenderDocument.id).filter_by(storage_name=item["storage_name"]).first():
                continue
            source = DATA_FILE.parent / "seed_documents" / Path(item["source_filename"]).name
            if not source.is_file():
                log.warning("Prototype source document is missing: %s", source.name)
                continue
            root = settings.upload_dir.resolve()
            target = (settings.upload_dir / item["storage_name"]).resolve()
            if not target.is_relative_to(root):
                raise ValueError("Prototype document path is outside the upload directory")
            target.parent.mkdir(parents=True, exist_ok=True)
            if not target.exists():
                shutil.copy2(source, target)
            db.add(models.TenderDocument(
                tender_id=tender.id,
                document_type=item["document_type"],
                label=item["label"],
                source_filename=item["source_filename"],
                storage_name=item["storage_name"],
                content_type="application/pdf",
                extra_data={"prototype_data": True, "source": data["source"]},
            ))

    db.commit()
    log.info("Prototype data loader inserted %d tender records", imported)
    return imported
