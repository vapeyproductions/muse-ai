#!/usr/bin/env python3
"""Build the static Muse catalog from the two curated Excel workbooks.

Uses only the Python standard library so the import stays reproducible without
adding a spreadsheet parser to the web application's dependency tree.
"""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
import zipfile
from collections import defaultdict
from pathlib import Path
from xml.etree import ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
PHOTO_WORKBOOK = ROOT / "data/source/Muse_photo_dashboard_2026-08-16.xlsx"
FEATURE_WORKBOOK = ROOT / "data/source/Muse AI - Cleaned-2.xlsm"
OUTPUT = ROOT / "src/data/muse-catalog.json"

MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"

NAME_FIXES = {
    "Jennifer Anniston": "Jennifer Aniston",
    "Kirsten Dunce": "Kirsten Dunst",
}

FEATURE_KEYS = {
    "Celebrity Name": "name",
    "Fitzpatrick Skin Type (Approx. 1–6)": "fitzpatrick",
    "Eye Color": "eyeColor",
    "Eyebrow Color": "eyebrowColor",
    "Hair Color": "hairColor",
    "Hair Length": "hairLength",
    "Face Shape": "faceShape",
    "Eye Shape": "eyeShape",
    "Eye Size": "eyeSize",
    "Eye Angle": "eyeAngle",
    "Eye Spacing": "eyeSpacing",
    "Eyelid Type": "eyelidType",
    "Eyebrow Shape": "eyebrowShape",
    "Eyebrow Thickness": "eyebrowThickness",
    "Eyebrow Spacing": "eyebrowSpacing",
    "Eyebrow Length": "eyebrowLength",
    "Lip Shape": "lipShape",
    "Nose Width": "noseWidth",
    "Nose Length": "noseLength",
    "Cheekbones": "cheekbones",
}

HAIR_TYPE_NUMBERS = {
    "1": 1,
    "2A": 2,
    "2B": 3,
    "2C": 4,
    "3A": 5,
    "3B": 6,
    "3C": 7,
    "4A": 8,
    "4B": 9,
    "4C": 10,
}


def column_index(reference: str) -> int:
    letters = re.match(r"[A-Z]+", reference).group(0)
    value = 0
    for char in letters:
        value = value * 26 + ord(char) - 64
    return value - 1


def text_value(node: ET.Element) -> str:
    return "".join(part.text or "" for part in node.findall(f".//{{{MAIN_NS}}}t"))


def read_sheet(path: Path, sheet_name: str) -> list[list[object]]:
    with zipfile.ZipFile(path) as archive:
        shared_strings: list[str] = []
        if "xl/sharedStrings.xml" in archive.namelist():
            root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            shared_strings = [text_value(item) for item in root.findall(f"{{{MAIN_NS}}}si")]

        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        relationship_id = None
        for sheet in workbook.findall(f".//{{{MAIN_NS}}}sheet"):
            if sheet.attrib.get("name") == sheet_name:
                relationship_id = sheet.attrib.get(f"{{{REL_NS}}}id")
                break
        if not relationship_id:
            raise ValueError(f"Sheet {sheet_name!r} not found in {path.name}")

        relationships = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        target = None
        for relationship in relationships.findall(f"{{{PKG_REL_NS}}}Relationship"):
            if relationship.attrib.get("Id") == relationship_id:
                target = relationship.attrib["Target"]
                break
        if not target:
            raise ValueError(f"Relationship for {sheet_name!r} not found in {path.name}")
        sheet_path = target.lstrip("/") if target.startswith("/xl/") else f"xl/{target.lstrip('/')}"

        xml = ET.fromstring(archive.read(sheet_path))
        rows: list[list[object]] = []
        for row in xml.findall(f".//{{{MAIN_NS}}}row"):
            values: list[object] = []
            for cell in row.findall(f"{{{MAIN_NS}}}c"):
                index = column_index(cell.attrib["r"])
                while len(values) <= index:
                    values.append("")
                kind = cell.attrib.get("t")
                if kind == "inlineStr":
                    value: object = text_value(cell)
                else:
                    raw = cell.findtext(f"{{{MAIN_NS}}}v", default="")
                    if kind == "s" and raw:
                        value = shared_strings[int(raw)]
                    elif kind in {"str", "e"}:
                        value = raw
                    elif kind == "b":
                        value = raw == "1"
                    elif raw:
                        number = float(raw)
                        value = int(number) if number.is_integer() else number
                    else:
                        value = ""
                values[index] = value
            rows.append(values)
        return rows


def slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", normalized.lower()).strip("-")


def normalized_name(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", " ", normalized.lower()).strip()


def clean(value: object) -> str:
    return str(value).strip() if value is not None else ""


def canonical_hair_type(value: object) -> str:
    label = re.sub(r"\s+", "", clean(value).upper()).removeprefix("TYPE")
    # Type 1 has no lettered subtypes. Treat a stray 1A/1B/1C entry as Type 1.
    if label in {"1", "1A", "1B", "1C"}:
        return "1"
    return label if label in HAIR_TYPE_NUMBERS else ""


def hair_type_profile(primary_value: object, secondary_value: object) -> dict[str, object]:
    primary = canonical_hair_type(primary_value)
    secondary = canonical_hair_type(secondary_value)
    if not primary:
        return {"hairTypePrimary": "", "hairTypeSecondary": "", "hairTypeScore": None}
    if clean(secondary_value) and not secondary:
        return {"hairTypePrimary": primary, "hairTypeSecondary": "", "hairTypeScore": None}

    scores = [HAIR_TYPE_NUMBERS[primary]]
    if secondary:
        scores.append(HAIR_TYPE_NUMBERS[secondary])
    average = sum(scores) / len(scores)
    return {
        "hairTypePrimary": primary,
        "hairTypeSecondary": secondary,
        "hairTypeScore": int(average) if average.is_integer() else average,
    }


def row_dict(headers: list[str], row: list[object]) -> dict[str, object]:
    return {header: row[index] if index < len(row) else "" for index, header in enumerate(headers) if header}


def asset_id(url: str) -> str:
    return f"asset-{hashlib.sha1(url.encode()).hexdigest()[:14]}"


def main() -> None:
    photo_rows = read_sheet(PHOTO_WORKBOOK, "Photos")
    feature_rows = read_sheet(FEATURE_WORKBOOK, "Sheet1")

    photo_headers = [clean(value) for value in photo_rows[0]]
    feature_headers = [clean(value) for value in feature_rows[0]]

    feature_profiles: dict[str, dict[str, object]] = {}
    for raw in feature_rows[1:]:
        source = row_dict(feature_headers, raw)
        name = clean(source.get("Celebrity Name"))
        if not name:
            continue
        profile: dict[str, object] = {}
        for source_key, output_key in FEATURE_KEYS.items():
            if output_key == "name":
                continue
            value = source.get(source_key, "")
            profile[output_key] = value
        profile.update(hair_type_profile(source.get("Hair Type"), source.get("Hair Type 2")))
        feature_profiles[name] = profile

    canonical_names = {normalized_name(name): name for name in feature_profiles}

    records: list[dict[str, object]] = []
    for raw in photo_rows[1:]:
        record = row_dict(photo_headers, raw)
        name = NAME_FIXES.get(clean(record.get("Celeb")), clean(record.get("Celeb")))
        if not name:
            continue
        name = canonical_names.get(normalized_name(name), name)
        record["Celeb"] = name
        records.append(record)

    assets: dict[str, dict[str, object]] = {}
    rows_by_muse: dict[str, list[dict[str, object]]] = defaultdict(list)
    for record in records:
        name = clean(record["Celeb"])
        image_url = clean(record.get("Image address"))
        identifier = asset_id(image_url)
        width = int(record.get("Width") or 0)
        height = int(record.get("Height") or 0)
        approved = clean(record.get("Meets guidelines")).lower() == "yes"
        if identifier not in assets:
            assets[identifier] = {
                "id": identifier,
                "imageUrl": image_url,
                "sourceUrl": clean(record.get("link")),
                "width": width,
                "height": height,
                "approved": approved,
            }
        else:
            assets[identifier]["approved"] = bool(assets[identifier]["approved"] or approved)
        record["assetId"] = identifier
        rows_by_muse[name].append(record)

    muses: list[dict[str, object]] = []
    look_count = 0
    for name in sorted(rows_by_muse):
        profile = feature_profiles.get(name)
        if profile is None:
            raise ValueError(f"No feature profile found for {name}")
        if profile.get("hairTypeScore") is None:
            raise ValueError(f"No valid hair type profile found for {name}")

        intro_asset_ids: list[str] = []
        look_rows: dict[tuple[str, str], list[dict[str, object]]] = defaultdict(list)
        for record in rows_by_muse[name]:
            category = clean(record.get("Category"))
            if category == "Intro photo":
                if record["assetId"] not in intro_asset_ids:
                    intro_asset_ids.append(str(record["assetId"]))
                continue
            look_rows[(category.lower(), clean(record.get("Subgroup")))].append(record)

        looks: list[dict[str, object]] = []
        for (kind, label), grouped_rows in sorted(look_rows.items()):
            gallery_asset_ids = list(dict.fromkeys(str(row["assetId"]) for row in grouped_rows))
            template_rows = [row for row in grouped_rows if clean(row.get("Template")).lower() == "yes"]
            if len(template_rows) != 1:
                raise ValueError(f"Expected one template for {name} / {kind} / {label}")

            prefix = "Makeup — " if kind == "makeup" else "Hair — "
            descriptors = sorted({
                header.removeprefix(prefix)
                for row in grouped_rows
                for header in photo_headers
                if header.startswith(prefix) and clean(row.get(header)).lower() == "yes"
            })
            if not descriptors:
                descriptors = sorted({
                    token.strip()
                    for row in grouped_rows
                    for token in clean(row.get("Descriptors")).split(",")
                    if token.strip()
                })

            looks.append({
                "id": f"{slugify(name)}-{kind}-{slugify(label)}",
                "kind": kind,
                "label": label,
                "descriptors": descriptors,
                "templateAssetId": str(template_rows[0]["assetId"]),
                "galleryAssetIds": gallery_asset_ids,
            })
            look_count += 1

        muses.append({
            "id": slugify(name),
            "name": name,
            "features": profile,
            "introAssetIds": intro_asset_ids,
            "looks": looks,
        })

    catalog = {
        "version": "2026-08-16",
        "stats": {
            "muses": len(muses),
            "photoRecords": len(records),
            "assets": len(assets),
            "looks": look_count,
        },
        "assets": assets,
        "muses": muses,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(catalog, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps(catalog["stats"], indent=2))
    print(f"Wrote {OUTPUT} ({OUTPUT.stat().st_size / 1024:.1f} KiB)")


if __name__ == "__main__":
    main()
