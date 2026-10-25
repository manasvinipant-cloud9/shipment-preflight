"""Batch input: the official test-data workbook -> one pre-flight report per booking.

Expected structure (Case 2 template; judges upload Sheets 1 and 2 only):
  Sheet "Bookings": title row, header row (Booking ID, Seller name, Origin city, ... Delivery appointment booked),
                    then one row per shipment.
  Sheet "Items":    title row, header row (Booking ID, SKU, Description, HS code, Quantity (units), Unit price, ...),
                    then one row per product, linked by Booking ID.
  Optional "Carrier options" sheet overrides the built-in rate card; "Rulebook" is informational (the ten rules
  are implemented in code).
Accepts one .xlsx/.xlsm/.ods workbook, or a pair of CSV files (bookings + items). The header row is found by
content, so the template's title row and grey example row are handled; blank rows are skipped.
"""
from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Iterable, Optional

from .carriers import DEFAULT_RATE_CARD, Lane
from .conversation import ITEM_SLOTS, SHIPMENT_SLOTS, Conversation
from .extractor import dict_to_ops
from .models import Shipment
from .report import PreflightReport, preflight


class SheetError(ValueError):
    pass


@dataclass
class BookingResult:
    booking_id: str
    shipment: Shipment
    report: PreflightReport
    notes: list[str]            # data-quality notes: unreadable cells, missing required fields, orphan rows


def _key(h) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(h if h is not None else "").strip().lower()).strip("_")


def _blank(v) -> bool:
    return v is None or (isinstance(v, float) and v != v) or str(v).strip() == ""


BOOKING_COLS = {
    "booking_id": "booking_id", "seller_name": "seller_name", "origin_city": "origin_city",
    "origin_country": "origin_country", "destination_city": "destination_city",
    "destination_country": "destination_country", "destination_type": "destination_type",
    "ready_to_ship_date": "ready_date", "seller_priority": "priority", "pallets": "pallets",
    "cartons": "total_cartons", "total_declared_value": "total_declared_value_gbp", "currency": "currency",
    "total_gross_weight_kg": "total_gross_weight_kg", "delivery_appointment_booked": "delivery_appointment_booked",
}
ITEM_COLS = {
    "booking_id": "booking_id", "sku": "sku", "description": "description", "hs_code": "hs_code",
    "quantity_units": "quantity", "unit_price": "unit_price_gbp", "units_per_carton": "units_per_carton",
    "cartons": "cartons", "unit_weight_kg": "unit_weight_kg", "country_of_origin": "country_of_origin",
}
CARRIER_COLS = {
    "carrier": "name", "service": "service", "origin_country": "origin", "destination_country": "destination",
    "price_per_pallet": "price", "transit_time_days": "days", "on_time_rate": "ontime",
    "max_weight_per_pallet_kg": "maxkg",
}


# ----------------------------------------------------------------------------------------- readers
def _table(rows: Iterable[list], cols: dict, anchor: str, label: str) -> list[dict]:
    """Find the header row (first row containing `anchor`), map known columns, return dict rows."""
    rows = [list(r) for r in rows]
    for i, r in enumerate(rows):
        keys = [_key(c) for c in r]
        if any(k == anchor or k.startswith(anchor) for k in keys):
            header = [cols.get(k) or cols.get(re.sub(r"_(gbp|number|text)$", "", k)) for k in keys]
            if "booking_id" in cols.values() and not any(header):
                continue
            out = []
            for row in rows[i + 1:]:
                d = {h: v for h, v in zip(header, row) if h and not _blank(v)}
                if d:
                    out.append(d)
            return out
    raise SheetError(f"Couldn't find the header row of the {label} sheet (expected a '{anchor.replace('_', ' ').title()}' column).")


def _sheet_rows(name: str, data: bytes) -> dict[str, list[list]]:
    ext = name.lower().rsplit(".", 1)[-1]
    if ext in ("xlsx", "xlsm"):
        try:
            from openpyxl import load_workbook
        except ImportError as e:
            raise SheetError("Excel support needs openpyxl (pip install openpyxl).") from e
        wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        return {ws.title: [list(r) for r in ws.iter_rows(values_only=True)] for ws in wb.worksheets}
    if ext == "ods":
        try:
            import pandas as pd
            x = pd.read_excel(io.BytesIO(data), engine="odf", sheet_name=None, header=None)
        except ImportError as e:
            raise SheetError("ODS support needs pandas + odfpy; or save the file as .xlsx.") from e
        return {n: df.astype(object).where(df.notna(), None).values.tolist() for n, df in x.items()}
    if ext == "csv":
        return {name: list(csv.reader(io.StringIO(data.decode("utf-8-sig", errors="replace"))))}
    raise SheetError(f"Unsupported file type '.{ext}'. Upload .xlsx, .ods, or two .csv files.")


def _find(sheets: dict, *words: str) -> Optional[list]:
    for n, rows in sheets.items():
        if any(w in n.lower() for w in words):
            return rows
    return None


def load_rate_card(rows: list[list]) -> list[Lane]:
    out = []
    for d in _table(rows, CARRIER_COLS, "carrier", "Carrier options"):
        try:
            out.append(Lane(str(d["name"]).strip(), str(d["service"]).strip(), str(d["origin"]).strip(),
                            str(d["destination"]).strip(), Decimal(str(d["price"])), int(float(d["days"])),
                            Decimal(str(d["ontime"])), Decimal(str(d["maxkg"]))))
        except (KeyError, ValueError, ArithmeticError) as e:
            raise SheetError(f"Carrier options sheet has an unreadable row: {d} ({e})") from e
    if not out:
        raise SheetError("The Carrier options sheet has no rows.")
    return out


def read_workbook(files: list[tuple[str, bytes]]) -> tuple[list[dict], list[dict], Optional[list[Lane]]]:
    """Returns (booking rows, item rows, rate card override or None)."""
    if not files:
        raise SheetError("No file provided.")
    sheets: dict[str, list[list]] = {}
    for name, data in files:
        sheets.update(_sheet_rows(name, data))
    b_rows = _find(sheets, "booking")
    i_rows = _find(sheets, "item")
    if b_rows is None or i_rows is None:                       # CSV pair: tell them apart by header content
        for n, rows in sheets.items():
            keys = {_key(c) for r in rows[:5] for c in r}
            if "sku" in keys: i_rows = rows
            elif "seller_name" in keys or "pallets" in keys: b_rows = rows
    if b_rows is None:
        raise SheetError("No 'Bookings' sheet found. Upload the template workbook, or a Bookings CSV and an Items CSV.")
    if i_rows is None:
        raise SheetError("No 'Items' sheet found. Upload the template workbook, or a Bookings CSV and an Items CSV.")
    card_rows = _find(sheets, "carrier")
    return (_table(b_rows, BOOKING_COLS, "booking_id", "Bookings"), _table(i_rows, ITEM_COLS, "booking_id", "Items"),
            load_rate_card(card_rows) if card_rows else None)


# ----------------------------------------------------------------------------------------- processing
def _check_one(bid: str, brow: dict, items: list[dict], today: date, card: list[Lane]) -> BookingResult:
    notes: list[str] = []
    data = {k: v for k, v in brow.items() if k != "currency"}
    cur = str(brow.get("currency", "GBP")).strip().upper()
    if cur != "GBP":
        notes.append(f"Currency is {cur}; only GBP is supported, so values were read as GBP.")
    data["origin_country"] = data.get("origin_country") or "United Kingdom"
    data["items"] = [{**i, "sku": i.get("sku") or f"ITEM-{n}"} for n, i in enumerate(items, 1)]

    conv = Conversation(extractor=lambda *_: [], today=today)
    _, errors, _ = conv.apply_patch(dict_to_ops(data))
    s = conv.shipment
    notes += [f"Couldn't read a value: {e}" for e in errors]
    if not s.items:
        notes.append("No items were found for this booking on the Items sheet.")
    if not s.priority:
        s.priority = "Balanced"
        notes.append("Seller priority is missing; assumed Balanced.")
    notes += [f"Missing booking field: {f}" for f, _ in SHIPMENT_SLOTS if getattr(s, f) is None and f != "priority"]
    for it in s.items:     # HS code and origin may legitimately be blank: rules R-01 / R-09 report them
        notes += [f"Missing for {it.sku}: {f}" for f, _ in ITEM_SLOTS if getattr(it, f) is None]
    return BookingResult(bid, s, preflight(s, today, strict=True, card=card, interactive=False), notes)


def run_batch(files: list[tuple[str, bytes]], today: Optional[date] = None,
              card: Optional[list[Lane]] = None) -> tuple[list[BookingResult], list[str]]:
    """Check every booking. Returns (results in file order, file-level notes)."""
    today = today or date.today()
    bookings, items, override = read_workbook(files)
    card = override or card or DEFAULT_RATE_CARD
    file_notes = ["Used the rate card from the uploaded 'Carrier options' sheet."] if override else []
    by_id: dict[str, list[dict]] = {}
    for it in items:
        by_id.setdefault(str(it.get("booking_id")).strip(), []).append(it)
    results, seen = [], set()
    for n, b in enumerate(bookings, 1):
        bid = str(b.get("booking_id") or f"ROW-{n}").strip()
        if bid in seen:
            file_notes.append(f"Duplicate Booking ID {bid}: every occurrence is checked separately.")
        seen.add(bid)
        results.append(_check_one(bid, {**b, "booking_id": bid}, by_id.get(bid, []), today, card))
    orphans = sorted(set(by_id) - seen)
    if orphans:
        file_notes.append(f"Items reference Booking IDs that are not on the Bookings sheet: {', '.join(orphans)}.")
    if not results:
        raise SheetError("The Bookings sheet has no data rows.")
    return results, file_notes


# ----------------------------------------------------------------------------------------- exports
def findings_csv(results: list[BookingResult]) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["booking_id", "seller", "status", "severity", "rule_id", "issue", "detail", "fix",
                "recommended_carrier", "cost_gbp", "transit_days"])
    for r in results:
        rec = r.report.recommendation
        tail = [f"{rec.lane.label}", f"{rec.cost_gbp:.2f}", rec.transit_days] if rec else ["", "", ""]
        fs = r.report.errors + r.report.warnings
        if not fs:
            w.writerow([r.booking_id, r.shipment.seller_name, r.report.status, "", "", "No issues", "", "", *tail])
        for f in fs:
            w.writerow([r.booking_id, r.shipment.seller_name, r.report.status, f.severity.value, f.rule_id,
                        f.title, f.detail, f.fix, *tail])
    return buf.getvalue()


def confirmations_text(results: list[BookingResult]) -> str:
    return ("\n" + "=" * 78 + "\n").join(f"{r.booking_id}  [{r.report.status}]\n{r.report.summary}\n\n"
                                          f"Why this carrier: {r.report.justification}" for r in results)
