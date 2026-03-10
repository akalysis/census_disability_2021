#!/usr/bin/env python3

import csv
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SOURCE_CSV = ROOT / "40399681182960600.csv"
OUTPUT_JS = ROOT / "data" / "app-data.js"

MSOA_SERVICE = (
    "https://services1.arcgis.com/ESMARspQHYMw9BZ9/ArcGIS/rest/services/"
    "Middle_layer_Super_Output_Areas_December_2021_Boundaries_EW_BSC_V3/FeatureServer/0"
)
REGION_SERVICE = (
    "https://services1.arcgis.com/ESMARspQHYMw9BZ9/ArcGIS/rest/services/"
    "Regions_December_2023_Boundaries_EN_BGC/FeatureServer/0"
)

REGION_ORDER = {
    "North East": 0,
    "North West": 1,
    "Yorkshire and The Humber": 2,
    "East Midlands": 3,
    "West Midlands": 4,
    "East of England": 5,
    "London": 6,
    "South East": 7,
    "South West": 8,
}


def fetch_json(url, params=None):
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    with urllib.request.urlopen(url) as response:
        return json.load(response)


def load_csv_rows(path):
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.reader(handle))


def parse_blocks(rows):
    header_key = "2021 super output area - middle layer"
    blocks = {}

    for index, row in enumerate(rows):
        if not row or row[0] != header_key:
            continue

        disability = None
        sex = None
        cursor = index - 1
        while cursor >= 0 and (disability is None or sex is None):
            candidate = rows[cursor]
            if len(candidate) > 1 and candidate[0].startswith("Disability"):
                disability = candidate[1].strip()
            elif len(candidate) > 1 and candidate[0].startswith("Sex"):
                sex = candidate[1].strip()
            cursor -= 1

        if disability is None or sex is None:
            raise ValueError(f"Could not read metadata for block starting on row {index + 1}.")

        headers = row[1:]
        data = {}

        for record in rows[index + 2 :]:
            if not record or not record[0] or " : " not in record[0]:
                break
            code, name = record[0].split(" : ", 1)
            if not code.startswith("E"):
                continue
            values = [int(value) for value in record[1:]]
            data[code] = {"name": name, "values": values}

        blocks[(disability, sex)] = {"headers": headers, "data": data}

    return blocks


def build_population_lookup(blocks):
    disabled_key = ("Disabled under the Equality Act", "All persons")
    not_disabled_key = ("Not disabled under the Equality Act", "All persons")

    disabled_block = blocks.get(disabled_key)
    not_disabled_block = blocks.get(not_disabled_key)
    if not disabled_block or not not_disabled_block:
        raise ValueError("Required disability blocks were not found in the Nomis file.")

    headers = disabled_block["headers"]
    age_headers = headers[1:]

    age_bands = [
        {"id": "age_0_9", "label": "Aged 9 years and under", "shortLabel": "0-9"},
        {"id": "age_10_14", "label": "Aged 10 to 14 years", "shortLabel": "10-14"},
        {"id": "age_15_24", "label": "Aged 15 to 24 years", "shortLabel": "15-24"},
        {"id": "age_25_34", "label": "Aged 25 to 34 years", "shortLabel": "25-34"},
        {"id": "age_35_39", "label": "Aged 35 to 39 years", "shortLabel": "35-39"},
        {"id": "age_40_44", "label": "Aged 40 to 44 years", "shortLabel": "40-44"},
        {"id": "age_45_49", "label": "Aged 45 to 49 years", "shortLabel": "45-49"},
        {"id": "age_50_54", "label": "Aged 50 to 54 years", "shortLabel": "50-54"},
        {"id": "age_55_64", "label": "Aged 55 to 64 years", "shortLabel": "55-64"},
        {"id": "age_65_74", "label": "Aged 65 to 74 years", "shortLabel": "65-74"},
        {"id": "age_75_84", "label": "Aged 75 to 84 years", "shortLabel": "75-84"},
        {"id": "age_85_plus", "label": "Aged 85 years and over", "shortLabel": "85+"},
    ]
    if age_headers != [band["label"] for band in age_bands]:
        raise ValueError("Unexpected age band order in the source CSV.")

    lookup = {}
    for code, disabled_record in disabled_block["data"].items():
        not_disabled_record = not_disabled_block["data"].get(code)
        if not not_disabled_record:
            continue
        disabled = disabled_record["values"][1:]
        not_disabled = not_disabled_record["values"][1:]
        total = [left + right for left, right in zip(disabled, not_disabled)]
        lookup[code] = {
            "name": disabled_record["name"],
            "disabled": disabled,
            "total": total,
        }

    return age_bands, lookup


def fetch_msoa_features():
    ids = fetch_json(
        f"{MSOA_SERVICE}/query",
        {
            "where": "MSOA21CD like 'E%'",
            "returnIdsOnly": "true",
            "f": "pjson",
        },
    )["objectIds"]

    features = []
    batch_size = 2000
    for offset in range(0, len(ids), batch_size):
        batch_geojson = fetch_json(
            f"{MSOA_SERVICE}/query",
            {
                "where": "MSOA21CD like 'E%'",
                "outFields": "MSOA21CD,MSOA21NM,LAT,LONG",
                "returnGeometry": "true",
                "resultOffset": offset,
                "resultRecordCount": batch_size,
                "orderByFields": "MSOA21CD",
                "f": "geojson",
            },
        )
        features.extend(batch_geojson["features"])
        print(f"Fetched MSOA boundaries {min(offset + batch_size, len(ids))}/{len(ids)}", file=sys.stderr)

    return features


def fetch_region_features():
    return fetch_json(
        f"{REGION_SERVICE}/query",
        {
            "where": "1=1",
            "outFields": "RGN23CD,RGN23NM",
            "returnGeometry": "true",
            "f": "geojson",
        },
    )["features"]


def point_in_ring(point, ring):
    x, y = point
    inside = False
    previous = ring[-1]
    for current in ring:
        x1, y1 = previous
        x2, y2 = current
        intersects = (y1 > y) != (y2 > y)
        if intersects:
            slope_x = (x2 - x1) * (y - y1) / ((y2 - y1) or 1e-12) + x1
            if x < slope_x:
                inside = not inside
        previous = current
    return inside


def point_in_polygon(point, polygon):
    if not point_in_ring(point, polygon[0]):
        return False
    return not any(point_in_ring(point, hole) for hole in polygon[1:])


def point_in_geometry(point, geometry):
    if geometry["type"] == "Polygon":
        return point_in_polygon(point, geometry["coordinates"])
    if geometry["type"] == "MultiPolygon":
        return any(point_in_polygon(point, polygon) for polygon in geometry["coordinates"])
    return False


def assign_region(point, regions):
    for region in regions:
        if point_in_geometry(point, region["geometry"]):
            return region["properties"]["RGN23CD"], region["properties"]["RGN23NM"]
    raise ValueError(f"Could not assign region for point {point}.")


def ring_area(ring):
    area = 0.0
    previous = ring[-1]
    for current in ring:
        area += previous[0] * current[1] - current[0] * previous[1]
        previous = current
    return area / 2.0


def ring_centroid(ring):
    signed_area = ring_area(ring)
    if abs(signed_area) < 1e-12:
        return fallback_center_for_points(ring)

    cx = 0.0
    cy = 0.0
    previous = ring[-1]
    for current in ring:
        cross = previous[0] * current[1] - current[0] * previous[1]
        cx += (previous[0] + current[0]) * cross
        cy += (previous[1] + current[1]) * cross
        previous = current

    factor = 1.0 / (6.0 * signed_area)
    return [cx * factor, cy * factor]


def fallback_center_for_points(points):
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    return [(min(xs) + max(xs)) / 2.0, (min(ys) + max(ys)) / 2.0]


def geometry_label_point(geometry):
    if geometry["type"] == "Polygon":
        return ring_centroid(geometry["coordinates"][0])

    if geometry["type"] == "MultiPolygon":
        polygons = geometry["coordinates"]
        largest = max(polygons, key=lambda polygon: abs(ring_area(polygon[0])))
        return ring_centroid(largest[0])

    raise ValueError(f"Unsupported geometry type for label point: {geometry['type']}")


def build_feature_collection(msoa_features, regions, counts_lookup):
    region_totals = {}
    england_disabled = None
    england_total = None
    joined = []

    for feature in msoa_features:
        props = feature["properties"]
        code = props["MSOA21CD"]
        counts = counts_lookup.get(code)
        if not counts:
            continue

        point = (props["LONG"], props["LAT"])
        region_code, region_name = assign_region(point, regions)
        disabled = counts["disabled"]
        total = counts["total"]

        if england_disabled is None:
            england_disabled = [0] * len(disabled)
            england_total = [0] * len(total)

        england_disabled = [left + right for left, right in zip(england_disabled, disabled)]
        england_total = [left + right for left, right in zip(england_total, total)]

        region_record = region_totals.setdefault(
            region_code,
            {"code": region_code, "name": region_name, "disabled": [0] * len(disabled), "total": [0] * len(total)},
        )
        region_record["disabled"] = [
            left + right for left, right in zip(region_record["disabled"], disabled)
        ]
        region_record["total"] = [left + right for left, right in zip(region_record["total"], total)]

        joined.append(
            {
                "type": "Feature",
                "id": code,
                "geometry": feature["geometry"],
                "properties": {
                    "c": code,
                    "n": counts["name"],
                    "r": region_name,
                    "rc": region_code,
                    "d": disabled,
                    "t": total,
                },
            }
        )

    joined.sort(key=lambda feature: feature["properties"]["c"])
    region_summaries = sorted(
        region_totals.values(),
        key=lambda region: (REGION_ORDER.get(region["name"], 99), region["name"]),
    )

    region_boundaries = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": feature["geometry"],
                "properties": {
                    "code": feature["properties"]["RGN23CD"],
                    "name": feature["properties"]["RGN23NM"],
                },
            }
            for feature in sorted(
                regions,
                key=lambda feature: (
                    REGION_ORDER.get(feature["properties"]["RGN23NM"], 99),
                    feature["properties"]["RGN23NM"],
                ),
            )
        ],
    }

    region_labels = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": geometry_label_point(feature["geometry"]),
                },
                "properties": {
                    "code": feature["properties"]["RGN23CD"],
                    "name": feature["properties"]["RGN23NM"],
                },
            }
            for feature in sorted(
                regions,
                key=lambda feature: (
                    REGION_ORDER.get(feature["properties"]["RGN23NM"], 99),
                    feature["properties"]["RGN23NM"],
                ),
            )
        ],
    }

    return {
        "msoas": {"type": "FeatureCollection", "features": joined},
        "regionBoundaries": region_boundaries,
        "regionLabels": region_labels,
        "regions": region_summaries,
        "england": {"disabled": england_disabled, "total": england_total},
    }


def write_output(age_bands, collections):
    payload = {
        "meta": {
            "title": "England disability prevalence map",
            "date": "Census 2021",
            "unit": "Disabled under the Equality Act as a share of the selected population",
            "source": [
                "Nomis Census 2021 table RM073",
                "ONS Open Geography MSOA 2021 boundaries",
                "ONS Open Geography Regions December 2023 boundaries",
            ],
        },
        "ageBands": age_bands,
        **collections,
    }
    OUTPUT_JS.write_text(
        "window.DISABILITY_MAP_DATA=" + json.dumps(payload, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )


def main():
    rows = load_csv_rows(SOURCE_CSV)
    blocks = parse_blocks(rows)
    age_bands, counts_lookup = build_population_lookup(blocks)
    msoa_features = fetch_msoa_features()
    region_features = fetch_region_features()
    collections = build_feature_collection(msoa_features, region_features, counts_lookup)
    write_output(age_bands, collections)
    print(f"Wrote {OUTPUT_JS}")


if __name__ == "__main__":
    main()
