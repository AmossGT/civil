"""Import route features and their original KMZ files into spatial storage."""
import json
import logging
import shutil
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

from geoalchemy2 import WKTElement
from sqlalchemy.orm import Session

from . import models
from .config import settings

log = logging.getLogger(__name__)
MANIFEST = Path(__file__).with_name("prototype_geodata.json")
SOURCE_DIR = Path(__file__).with_name("seed_geodata")
KML_NS = {"k": "http://www.opengis.net/kml/2.2"}
KMZ_CONTENT_TYPE = "application/vnd.google-earth.kmz"


def _read_lines(kmz_path: Path):
    with zipfile.ZipFile(kmz_path) as archive:
        kml_names = [name for name in archive.namelist() if name.lower().endswith(".kml")]
        if not kml_names:
            raise ValueError(f"No KML document found in {kmz_path.name}")
        kml_info = archive.getinfo(kml_names[0])
        if kml_info.file_size > 50 * 1024 * 1024:
            raise ValueError(f"KML document is too large: {kmz_path.name}")
        root = ET.fromstring(archive.read(kml_info))

    features = []
    for ordinal, placemark in enumerate(root.findall(".//k:Placemark", KML_NS), start=1):
        lines = []
        for element in placemark.findall(".//k:LineString/k:coordinates", KML_NS):
            coordinates = []
            for row in (element.text or "").split():
                parts = row.split(",")
                if len(parts) < 2:
                    continue
                try:
                    longitude, latitude = float(parts[0]), float(parts[1])
                except ValueError:
                    continue
                if -180 <= longitude <= 180 and -90 <= latitude <= 90:
                    coordinates.append((longitude, latitude))
            if len(coordinates) >= 2:
                lines.append(coordinates)
        if not lines:
            continue

        name = (placemark.findtext("k:name", default="", namespaces=KML_NS) or "").strip()
        extended = {}
        for item in placemark.findall(".//k:ExtendedData/k:Data", KML_NS):
            key = (item.get("name") or "").strip()
            value = item.findtext("k:value", default="", namespaces=KML_NS)
            if key:
                extended[key] = value
        description = placemark.findtext("k:description", default="", namespaces=KML_NS)
        properties = {"description": description} if description else {}
        if extended:
            properties["extended_data"] = extended

        def pair(point):
            return f"{point[0]:.8f} {point[1]:.8f}"

        if len(lines) == 1:
            geometry_type = "LineString"
            body = ",".join(pair(point) for point in lines[0])
            wkt = f"LINESTRING({body})"
        else:
            geometry_type = "MultiLineString"
            groups = ["(" + ",".join(pair(point) for point in line) + ")" for line in lines]
            wkt = "MULTILINESTRING(" + ",".join(groups) + ")"
        features.append({
            "source_feature_id": f"placemark-{ordinal:04d}",
            "feature_name": name or f"Route {ordinal}",
            "geometry_type": geometry_type,
            "geometry": WKTElement(wkt, srid=4326),
            "properties": properties,
        })
    return features


def seed_spatial_data(db: Session) -> int:
    """Idempotently copy prototype KMZ files and import named route lines."""
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    imported = 0
    for source in manifest["routes"]:
        tender = db.query(models.Tender).filter_by(tender_ref=source["tender_ref"]).first()
        if tender is None:
            log.warning("Skipping route map for unknown tender %s", source["tender_ref"])
            continue
        kmz = SOURCE_DIR / Path(source["source_filename"]).name
        if not kmz.is_file():
            log.warning("Prototype route map is missing: %s", kmz.name)
            continue

        upload_root = settings.upload_dir.resolve()
        stored_kmz = (settings.upload_dir / source["storage_name"]).resolve()
        if not stored_kmz.is_relative_to(upload_root):
            raise ValueError("Prototype route map path is outside the upload directory")
        stored_kmz.parent.mkdir(parents=True, exist_ok=True)
        if not stored_kmz.exists():
            shutil.copy2(kmz, stored_kmz)

        document = db.query(models.TenderDocument.id).filter_by(storage_name=source["storage_name"]).first()
        if document is None:
            db.add(models.TenderDocument(
                tender_id=tender.id,
                document_type="route_map",
                label=source["document_label"],
                source_filename=source["source_filename"],
                storage_name=source["storage_name"],
                content_type=KMZ_CONTENT_TYPE,
                extra_data={"prototype_data": True, "source_note": manifest["source_note"]},
            ))

        existing = {
            feature_id for (feature_id,) in db.query(models.TenderSpatialFeature.source_feature_id)
            .filter_by(tender_id=tender.id, source_filename=source["source_filename"]).all()
        }
        features = _read_lines(kmz)
        rows = [models.TenderSpatialFeature(
            tender_id=tender.id,
            source_filename=source["source_filename"],
            source_feature_id=item["source_feature_id"],
            feature_name=item["feature_name"],
            geometry_type=item["geometry_type"],
            geometry=item["geometry"],
            properties=item["properties"],
        ) for item in features if item["source_feature_id"] not in existing]
        db.add_all(rows)
        imported += len(rows)
        log.info("Loaded %d route features from %s", len(rows), kmz.name)

    db.commit()
    return imported
