#!/usr/bin/env python3
"""
Convert legacy GAS Google Sheets export (TangoDB.xlsx) → tangodb_export.json
for import-org.mjs (legacy-gas format).

Usage:
  py scripts/xlsx-to-export.py path/to/TangoDB.xlsx [--output path/to/tangodb_export.json]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date, datetime
from pathlib import Path

try:
    import pandas as pd
except ImportError:
    print("Missing dependency: pip install pandas openpyxl", file=sys.stderr)
    sys.exit(1)

SHEET_MAP = {
    "Clients": "clients",
    "Schedule": "schedule",
    "Prices": "prices",
    "Subscriptions": "subscriptions",
    "Attendance": "attendance",
    "PersonalLessons": "personalLessons",
}

ID_COLUMNS = {
    "Clients": {"ID"},
    "Subscriptions": {"ID", "ClientID1", "ClientID2", "ClientID3"},
    "Attendance": {"SubscriptionID"},
    "PersonalLessons": {"ID", "ClientID1", "ClientID2", "ClientID3"},
}


def format_id(value) -> str | None:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    if isinstance(value, str):
        text = value.strip()
        if not text or text.lower() == "nan":
            return None
        if re.fullmatch(r"\d+\.0+", text):
            return text.split(".")[0]
        return text
    if isinstance(value, (int,)):
        return str(value)
    if isinstance(value, float):
        if value.is_integer():
            return str(int(value))
        text = f"{value:.0f}"
        return text
    return str(value).strip()


def format_date(value) -> str | None:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    if isinstance(value, (datetime, date)):
        return value.strftime("%Y-%m-%d")
    text = str(value).strip()
    if re.match(r"^\d{4}-\d{2}-\d{2}", text):
        return text[:10]
    parsed = pd.to_datetime(value, errors="coerce")
    if pd.isna(parsed):
        return text
    return parsed.strftime("%Y-%m-%d")


def format_time(value) -> str | None:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    if isinstance(value, (datetime,)):
        return value.strftime("%H:%M")
    text = str(value).strip()
    match = re.match(r"^(\d{1,2}):(\d{2})", text)
    if match:
        return f"{int(match.group(1)):02d}:{match.group(2)}"
    return text


def format_pair_month(value) -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    text = str(value).strip().lower()
    if not text or text == "nan":
        return ""
    if text.startswith("m") and text[1:] in {"1", "2", "3"}:
        return text
    if text in {"1", "2", "3"}:
        return f"m{text}"
    return text


def cell_text(value) -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    return str(value).strip()


def row_to_dict(row: pd.Series, sheet: str) -> dict:
    out: dict = {}
    id_cols = ID_COLUMNS.get(sheet, set())
    for col, value in row.items():
        if col in id_cols:
            out[col] = format_id(value)
            continue
        if col in {"ActivationDate", "Date"}:
            out[col] = format_date(value)
            continue
        if col == "Time":
            out[col] = format_time(value)
            continue
        if col == "MonthsPaid":
            out["PairMonth"] = format_pair_month(value)
            continue
        if col == "PairMonth":
            out["PairMonth"] = format_pair_month(value)
            continue
        if col in {"LessonsTotal", "LessonsLeft", "FreezeUsed", "Lessons", "Price", "DayOfWeek"}:
            if value is None or (isinstance(value, float) and pd.isna(value)):
                out[col] = None
            elif col == "DayOfWeek":
                out[col] = int(float(value))
            elif col == "Price":
                out[col] = float(value)
            else:
                out[col] = int(float(value))
            continue
        if value is None or (isinstance(value, float) and pd.isna(value)):
            out[col] = None
        else:
            text = cell_text(value)
            if col in {"FirstName", "LastName"} and text.lower() == "неизвестно":
                text = ""
            out[col] = text if text else ("" if col in {"FirstName", "LastName", "Telegram"} else None)
    return out


def load_sheet(path: Path, sheet: str) -> list[dict]:
    df = pd.read_excel(path, sheet_name=sheet, dtype=object)
    rows = []
    for _, row in df.iterrows():
        if row.isna().all():
            continue
        item = row_to_dict(row, sheet)
        if sheet == "Clients" and not item.get("ID"):
            continue
        if sheet == "Subscriptions" and not item.get("ID"):
            continue
        if sheet == "PersonalLessons" and not item.get("ID"):
            continue
        rows.append(item)
    return rows


def validate_summary(data: dict) -> dict:
    issues: list[dict] = []
    client_ids = {str(c["ID"]) for c in data["clients"]}
    sub_ids = {str(s["ID"]) for s in data["subscriptions"]}

    for sid in sub_ids:
        if len(sid) < 15:
            issues.append({"severity": "warning", "type": "short_subscription_id", "id": sid})

    for s in data["subscriptions"]:
        if s.get("Type") == "pair":
            pm = s.get("PairMonth") or ""
            if pm not in {"m1", "m2", "m3"}:
                issues.append(
                    {
                        "severity": "error",
                        "type": "pair_bad_month",
                        "id": s["ID"],
                        "pairMonth": pm,
                    }
                )
            if not s.get("ClientID2"):
                issues.append({"severity": "error", "type": "pair_no_client2", "id": s["ID"]})
        for key in ("ClientID1", "ClientID2"):
            cid = s.get(key)
            if cid and cid not in client_ids:
                issues.append({"severity": "info", "type": "missing_client_ref", "subId": s["ID"], "clientId": cid})

    for a in data["attendance"]:
        if str(a["SubscriptionID"]) not in sub_ids:
            issues.append(
                {
                    "severity": "error",
                    "type": "attendance_unknown_subscription",
                    "subscriptionId": a["SubscriptionID"],
                }
            )

    errors = [i for i in issues if i["severity"] == "error"]
    return {
        "ok": len(errors) == 0,
        "counts": {k: len(v) for k, v in data.items()},
        "issues": issues,
    }


def convert(path: Path) -> dict:
    xl = pd.ExcelFile(path)
    missing = [s for s in SHEET_MAP if s not in xl.sheet_names]
    if missing:
        raise SystemExit(f"Missing sheets: {missing}. Found: {xl.sheet_names}")

    data = {json_key: load_sheet(path, sheet) for sheet, json_key in SHEET_MAP.items()}
    return data


def main() -> None:
    parser = argparse.ArgumentParser(description="Convert TangoDB.xlsx → tangodb_export.json")
    parser.add_argument("input", type=Path, help="Path to TangoDB.xlsx")
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Output JSON path (default: data/import/<stem>/tangodb_export.json)",
    )
    args = parser.parse_args()

    if not args.input.exists():
        raise SystemExit(f"Input not found: {args.input}")

    output = args.output
    if output is None:
        output = Path(__file__).resolve().parent.parent / "data" / "import" / args.input.stem / "tangodb_export.json"

    data = convert(args.input)
    summary = validate_summary(data)

    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
        fh.write("\n")

    print(json.dumps({"output": str(output), **summary}, ensure_ascii=False, indent=2))
    if not summary["ok"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
