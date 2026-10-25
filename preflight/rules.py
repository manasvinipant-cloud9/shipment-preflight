"""Rulebook R-01..R-10. Each rule is a pure function (Shipment, Context) -> list[Finding].

Rules skip silently when their inputs are not collected yet (draft mode), so they can run
after every conversational turn for live warnings. `ctx.strict=True` (final pre-flight)
additionally treats blank HS code / origin as violations.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Callable, Optional

from .models import Finding, Severity, Shipment

RED, AMBER = Severity.RED, Severity.AMBER
VALUE_TOLERANCE = Decimal("0.01")

# Word-boundary patterns so "lighter fluid" hits but "delighted" does not.
DG_PATTERNS = {
    "lithium battery": r"\blithium\b|\bli[- ]?ion\b|\blipo\b|\bli[- ]?polymer\b|\bbattery pack\b|\bpower ?bank\b",
    "aerosol": r"\baerosols?\b|\bspray cans?\b|\bspray paint\b|\bhair ?spray\b|\bdeodorant spray\b"
               r"|\bpressuri[sz]ed (can|canister)s?\b|\bbutane\b|\bpropane\b",
    "flammable liquid": r"\bflammable\b|\bpetrol\b|\bgasoline\b|\bwhite spirit\b|\blighter fluid\b"
                        r"|\bmethylated spirits?\b|\bacetone\b|\bthinners?\b|\bnail polish remover\b|\bfuel\b",
}


@dataclass
class Context:
    today: date
    strict: bool = False
    # Max permitted gross kg per pallet. If a carrier is selected, its limit; otherwise the
    # most permissive limit across carriers serving the lane (Red only if NO carrier can take it).
    carrier_max_pallet_kg: Optional[Decimal] = None
    carrier_label: str = "any available carrier"


RULEBOOK = [   # Sheet 4, shown in the UI; the logic lives in the functions below
    ("R-01", "Every item must have an HS code of at least 6 digits", "Red"),
    ("R-02", "Total declared value must equal the sum of quantity × unit price across all items (within 1%)", "Red"),
    ("R-03", "For each item, units per carton × cartons must equal quantity", "Red"),
    ("R-04", "Total cartons on the booking must equal the sum of cartons across all items", "Red"),
    ("R-05", "Weight per pallet (total gross weight ÷ pallets) must not exceed the chosen carrier's max weight per pallet", "Red"),
    ("R-06", "No lithium batteries, aerosols or flammable liquids", "Red"),
    ("R-07", "Total gross weight must be at least the sum of unit weight × quantity across all items", "Amber"),
    ("R-08", "Shipments to a warehouse must have a delivery appointment booked", "Amber"),
    ("R-09", "Every item must have a country of origin", "Amber"),
    ("R-10", "Ready to ship date must not be in the past", "Amber"),
]

Rule = Callable[[Shipment, Context], list[Finding]]
RULES: dict[str, Rule] = {}


def rule(rid: str):
    def deco(fn: Rule) -> Rule:
        RULES[rid] = fn
        return fn
    return deco


def _ref(item) -> str:
    return f"items[{item.sku}]"


# ---------------------------------------------------------------- RED
@rule("R-01")
def hs_code_min_digits(s, ctx):
    out = []
    for it in s.items:
        if it.hs_code is None and not ctx.strict:
            continue
        digits = re.sub(r"[\s.\-]", "", it.hs_code or "")
        if not digits.isdigit() or len(digits) < 6:
            out.append(Finding(
                "R-01", RED, "HS code too short or invalid",
                f"{it.sku}: HS code '{it.hs_code or ''}' is not at least 6 digits.",
                "Provide the full commodity code (6+ digits, e.g. 6109.10). Customs rejects shorter codes.",
                f"{_ref(it)}.hs_code"))
    return out


@rule("R-02")
def declared_value_matches(s, ctx):
    if s.total_declared_value_gbp is None or not s.items:
        return []
    if any(i.quantity is None or i.unit_price_gbp is None for i in s.items):
        return []
    computed = sum((i.unit_price_gbp * i.quantity for i in s.items), Decimal(0))
    diff = abs(s.total_declared_value_gbp - computed)
    # Tolerance is relative to the computed line-item total; computed==0 requires exact match.
    if diff > computed * VALUE_TOLERANCE:
        pct = (diff / computed * 100) if computed else Decimal(100)
        return [Finding(
            "R-02", RED, "Declared value does not match line items",
            f"Declared £{s.total_declared_value_gbp:,.2f} vs £{computed:,.2f} from quantity × unit price "
            f"(off by £{diff:,.2f}, {pct:.1f}%; limit 1%).",
            f"Correct the total to £{computed:,.2f} or fix the quantities/unit prices.",
            "total_declared_value_gbp")]
    return []


@rule("R-03")
def carton_arithmetic(s, ctx):
    out = []
    for it in s.items:
        if None in (it.units_per_carton, it.cartons, it.quantity):
            continue
        expected = it.units_per_carton * it.cartons
        if expected != it.quantity:
            out.append(Finding(
                "R-03", RED, "Units per carton × cartons ≠ quantity",
                f"{it.sku}: {it.units_per_carton} × {it.cartons} = {expected}, but quantity is {it.quantity}.",
                "Correct the quantity, units per carton or carton count so they agree.",
                f"{_ref(it)}.quantity"))
    return out


@rule("R-04")
def total_cartons(s, ctx):
    if s.total_cartons is None or not s.items or any(i.cartons is None for i in s.items):
        return []
    total = sum(i.cartons for i in s.items)
    if total != s.total_cartons:
        return [Finding(
            "R-04", RED, "Total cartons does not match items",
            f"Shipment says {s.total_cartons} cartons; items add up to {total}.",
            f"Set total cartons to {total}, or correct the per-item carton counts.",
            "total_cartons")]
    return []


@rule("R-05")
def pallet_weight(s, ctx):
    if not s.pallets or s.total_gross_weight_kg is None or ctx.carrier_max_pallet_kg is None:
        return []
    per_pallet = s.total_gross_weight_kg / s.pallets
    if per_pallet > ctx.carrier_max_pallet_kg:
        need = -(-s.total_gross_weight_kg // ctx.carrier_max_pallet_kg)  # ceil
        return [Finding(
            "R-05", RED, "Pallet too heavy",
            f"{s.total_gross_weight_kg} kg over {s.pallets} pallet(s) = {per_pallet:.0f} kg/pallet; "
            f"{ctx.carrier_label} allows {ctx.carrier_max_pallet_kg} kg.",
            f"Split the load across at least {need} pallets, or choose a heavy-freight service.",
            "pallets")]
    return []


@rule("R-06")
def dangerous_goods(s, ctx):
    out = []
    for it in s.items:
        text = (it.description or "").lower()
        for label, pat in DG_PATTERNS.items():
            if re.search(pat, text):
                out.append(Finding(
                    "R-06", RED, f"Possible dangerous goods: {label}",
                    f"{it.sku}: description '{it.description}' matches {label} keywords.",
                    "Standard freight cannot carry this. Remove the item, or book a certified ADR/DG service "
                    "with a UN number and safety data sheet.",
                    f"{_ref(it)}.description"))
                break
    return out


# -------------------------------------------------------------- AMBER
@rule("R-07")
def gross_weight_plausible(s, ctx):
    if s.total_gross_weight_kg is None or not s.items:
        return []
    if any(i.unit_weight_kg is None or i.quantity is None for i in s.items):
        return []
    net = sum((i.unit_weight_kg * i.quantity for i in s.items), Decimal(0))
    if s.total_gross_weight_kg < net:
        return [Finding(
            "R-07", AMBER, "Gross weight lower than goods weight",
            f"Gross {s.total_gross_weight_kg} kg is less than goods alone ({net:.1f} kg). "
            "Gross must include packaging and pallets.",
            f"Re-weigh; gross should be at least {net:.1f} kg (typically goods + ~5-10% packaging + pallet).",
            "total_gross_weight_kg")]
    return []


@rule("R-08")
def appointment_for_warehouse(s, ctx):
    if s.destination_type == "Warehouse" and s.delivery_appointment_booked != "Yes":
        return [Finding(
            "R-08", AMBER, "No delivery appointment for warehouse",
            "Destination is a warehouse and no delivery appointment is confirmed.",
            "Book a slot with the consignee and give us the reference; otherwise delivery may be refused.",
            "delivery_appointment_booked")]
    return []


@rule("R-09")
def origin_present(s, ctx):
    out = []
    for it in s.items:
        if it.country_of_origin is None and not ctx.strict:
            continue
        if not (it.country_of_origin or "").strip():
            out.append(Finding(
                "R-09", AMBER, "Country of origin missing",
                f"{it.sku} has no country of origin.",
                "Add the country of origin (where goods were made); needed for customs and duty.",
                f"{_ref(it)}.country_of_origin"))
    return out


@rule("R-10")
def ready_date_not_past(s, ctx):
    if s.ready_date and s.ready_date < ctx.today:
        return [Finding(
            "R-10", AMBER, "Ready-to-ship date is in the past",
            f"Ready date {s.ready_date.isoformat()} is before today ({ctx.today.isoformat()}).",
            "Pick today or a future date when the goods will really be ready for collection.",
            "ready_date")]
    return []


def run_rules(s: Shipment, ctx: Context) -> list[Finding]:
    findings: list[Finding] = []
    for rid in sorted(RULES):
        findings.extend(RULES[rid](s, ctx))
    # Red first, then rule order: stable output for UI and tests.
    findings.sort(key=lambda f: (f.severity != RED, f.rule_id))
    return findings
