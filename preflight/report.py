"""Pre-flight pipeline: validate -> match carrier -> structured report + plain-language summary."""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from typing import Optional

from .carriers import (DEFAULT_RATE_CARD, Lane, Option, choose, fits, justify, lane_options, per_pallet_kg,
                       rank_detailed)
from .models import Finding, Severity, Shipment
from .rules import Context, run_rules


@dataclass
class PreflightReport:
    status: str                      # BLOCKED (any Red) | REVIEW (Amber only) | READY
    errors: list[Finding]
    warnings: list[Finding]
    recommendation: Optional[Option]
    alternatives: list[Option]
    justification: str
    summary: str
    provisional: bool                # True when Red errors mean the carrier pick may change after fixes
    booking_id: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "booking_id": self.booking_id,
            "status": self.status,
            "red": [f.to_dict() for f in self.errors],
            "amber": [f.to_dict() for f in self.warnings],
            "recommended_carrier": self.recommendation.to_dict() if self.recommendation else None,
            "alternatives": [o.to_dict() for o in self.alternatives],
            "justification": self.justification,
            "provisional": self.provisional,
            "summary": self.summary,
        }


def context_for(s: Shipment, today: date, strict: bool, card: list[Lane] = DEFAULT_RATE_CARD) -> Context:
    """R-05 is judged against the carrier the seller's priority points to (rulebook: 'the chosen carrier')."""
    chosen = choose(s, s.priority, card) if s.destination_country else None
    return Context(today=today, strict=strict,
                   carrier_max_pallet_kg=chosen.lane.max_pallet_kg if chosen else None,
                   carrier_label=chosen.lane.label if chosen else "the chosen carrier")


def _refine_r05(f: Finding, s: Shipment, chosen: Optional[Option], best: Optional[Option], card) -> None:
    """Turn the generic R-05 fix into concrete options using the real rate card."""
    pp = per_pallet_kg(s)
    limits = [o.lane.max_pallet_kg for o in lane_options(s, card)]
    split = lambda lim: math.ceil(s.total_gross_weight_kg / lim)
    if best and chosen and best.lane != chosen.lane:
        f.fix = (f"Either split the load over at least {split(chosen.lane.max_pallet_kg)} pallets so each is "
                 f"under {chosen.lane.max_pallet_kg:g} kg, or switch to {best.lane.label}, which accepts "
                 f"{best.lane.max_pallet_kg:g} kg per pallet (£{best.cost_gbp:,.2f}, "
                 f"{best.transit_days} days).")
    elif limits:
        f.fix = (f"No service on this route takes {pp:.0f} kg per pallet (the maximum is {max(limits):g} kg). "
                 f"Split the load over at least {split(max(limits))} pallets, or re-weigh if the figure is wrong.")


def preflight(s: Shipment, today: Optional[date] = None, strict: bool = True,
              card: list[Lane] = DEFAULT_RATE_CARD, interactive: bool = True) -> PreflightReport:
    today = today or date.today()
    ctx = context_for(s, today, strict, card)
    findings = run_rules(s, ctx)
    reds = [f for f in findings if f.severity == Severity.RED]
    ambers = [f for f in findings if f.severity == Severity.AMBER]

    options = lane_options(s, card) if s.destination_country else []
    chosen = choose(s, s.priority, card) if options else None
    ranked, dropped = rank_detailed(s, s.priority, card) if options else ([], [])
    best = ranked[0] if ranked else None
    for f in reds:
        if f.rule_id == "R-05":
            _refine_r05(f, s, chosen, best, card)

    if best:
        why = justify(s, ranked, s.priority, dropped, options)
    elif options:
        why = "No carrier on this route can take this load as declared, so no recommendation can be made yet."
    else:
        why = "No carrier serves this route."
    status = "BLOCKED" if reds else ("REVIEW" if ambers else "READY")
    return PreflightReport(status, reds, ambers, best, ranked[1:], why,
                           _summary(s, status, reds, ambers, best, interactive),
                           provisional=bool(reds), booking_id=s.booking_id)


def _fmt_date(d: Optional[date]) -> str:
    return d.strftime("%d-%m-%Y") if d else "?"


def collection_plan(s: Shipment, best: Optional[Option]) -> str:
    if not (best and s.ready_date):
        return ""
    eta = _fmt_date(s.ready_date + timedelta(days=best.transit_days))
    return (f"{best.lane.name} collects from {s.origin_city or 'the origin'} on {_fmt_date(s.ready_date)} and delivers to "
            f"{s.destination_city or s.destination_country} in about {best.transit_days} day(s) (around {eta}), "
            f"for £{best.cost_gbp:,.2f}.")


def _summary(s: Shipment, status: str, reds, ambers, best: Optional[Option], interactive: bool) -> str:
    money = lambda v: f"£{v:,.2f}" if isinstance(v, Decimal) else str(v)
    who = f"Booking {s.booking_id}" if s.booking_id else "Shipment"
    if s.seller_name:
        who += f" ({s.seller_name})"
    route = " to ".join(x for x in (
        ", ".join(p for p in (s.origin_city, s.origin_country) if p) or None,
        ", ".join(p for p in (s.destination_city, s.destination_country) if p) or None) if x)
    lines = [f"{who}: {route or 'route not set'} ({s.destination_type}), {s.pallets} pallet(s), "
             f"{s.total_gross_weight_kg} kg, {len(s.items)} product line(s), declared {money(s.total_declared_value_gbp)}, "
             f"ready {_fmt_date(s.ready_date)}. Priority: {s.priority}."]
    if reds:
        lines.append(f"{len(reds)} blocking issue(s) (Red) must be fixed before this can go:")
        lines += [f"  - [{f.rule_id}] {f.title}: {f.detail} Fix: {f.fix}" for f in reds]
    if ambers:
        lines.append("Warnings (Amber) to fix or check:")
        lines += [f"  - [{f.rule_id}] {f.title}: {f.detail} Fix: {f.fix}" for f in ambers]
    if best:
        lines.append(f"{'Provisional recommendation' if reds else 'Recommended carrier'}: {best.lane.label} - "
                     f"£{best.cost_gbp:,.2f}, {best.transit_days} day(s), {best.lane.on_time_pct:g}% on time.")
    lines.append("What happens next:")
    go = collection_plan(s, best)
    if status == "READY":
        lines.append(("  Everything checks out. Reply 'confirm' to book. " if interactive else "  Everything checks out. ") + go)
    elif status == "REVIEW":
        lines.append(("  You can confirm as-is, or correct the warnings first and I'll re-check. "
                      if interactive else "  Safe to proceed, but fix or check the warnings first. ") + go)
    else:
        lines.append("  Not booked. Send the corrections and the checks re-run instantly."
                     if interactive else "  Not booked. Correct the Red items and re-submit this booking.")
        if go:
            lines.append("  Once clear, the plan would be: " + go)
    return "\n".join(lines)
