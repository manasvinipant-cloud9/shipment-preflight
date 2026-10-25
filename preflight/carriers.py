"""Carrier eligibility, quoting, scoring and ranking against the fixed case rate card (Sheet 3).

Cost = price per pallet x pallets. Hard filters (pallet weight) exclude a carrier outright; the seller's
priority only re-weights the carriers that remain.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Optional

from .models import Shipment

D = Decimal


@dataclass(frozen=True)
class Lane:
    """One row of the rate card: a carrier service on one route."""
    name: str
    service: str
    origin: str
    destination: str
    price_per_pallet: Decimal
    transit_days: int
    on_time_pct: Decimal
    max_pallet_kg: Decimal

    @property
    def label(self) -> str:
        return f"{self.name} ({self.service})"


def _card() -> list[Lane]:
    uk = "United Kingdom"
    rows = [("Carrier A", "Road economy", 5, 92, 500, {"Germany": 180, "France": 170, "Netherlands": 160}),
            ("Carrier B", "Road standard", 3, 95, 750, {"Germany": 220, "France": 210, "Netherlands": 200}),
            ("Carrier C", "Road express", 2, 98, 400, {"Germany": 340, "France": 330, "Netherlands": 320})]
    return [Lane(n, s, uk, dest, D(price), days, D(ot), D(mx))
            for n, s, days, ot, mx, prices in rows for dest, price in prices.items()]


DEFAULT_RATE_CARD: list[Lane] = _card()

# (cost, speed, reliability) weights; each row sums to 1.
WEIGHTS = {
    "Cheapest":      (D("0.70"), D("0.15"), D("0.15")),
    "Fastest":       (D("0.10"), D("0.70"), D("0.20")),
    "Most reliable": (D("0.10"), D("0.15"), D("0.75")),
    "Balanced":      (D("0.40"), D("0.30"), D("0.30")),
}

# Cost-ratio cap: an option costing more than cap x the cheapest eligible option is dropped for that
# priority, so a small gain in speed/reliability can't justify a large premium. 'Fastest' is uncapped.
COST_CAP = {"Cheapest": D("1.5"), "Balanced": D("1.5"), "Most reliable": D(3), "Fastest": None}


@dataclass
class Option:
    lane: Lane
    cost_gbp: Decimal
    score: Decimal = D(0)

    @property
    def carrier(self) -> Lane:           # name/service/on_time_pct/max_pallet_kg live on the lane
        return self.lane

    @property
    def transit_days(self) -> int:
        return self.lane.transit_days

    def to_dict(self) -> dict:
        return {"carrier": self.lane.name, "service": self.lane.service,
                "cost_gbp": float(round(self.cost_gbp, 2)), "transit_days": self.transit_days,
                "on_time_pct": float(self.lane.on_time_pct), "max_pallet_kg": float(self.lane.max_pallet_kg),
                "score": float(round(self.score, 1))}


def per_pallet_kg(s: Shipment) -> Optional[Decimal]:
    if s.pallets and s.total_gross_weight_kg is not None:
        return s.total_gross_weight_kg / s.pallets
    return None


def lane_options(s: Shipment, card: list[Lane] = DEFAULT_RATE_CARD) -> list[Option]:
    """Every service that runs the booking's route, quoted, ignoring weight limits."""
    out = []
    for lane in card:
        if lane.destination != s.destination_country:
            continue
        if s.origin_country and lane.origin != s.origin_country:
            continue
        out.append(Option(lane, lane.price_per_pallet * (s.pallets or 1)))
    return out


def fits(s: Shipment, opt: Option) -> bool:
    pp = per_pallet_kg(s)
    return pp is None or pp <= opt.lane.max_pallet_kg


def rank_options(options: list[Option], priority: Optional[str]) -> tuple[list[Option], list[Option]]:
    """Returns (ranked best-first, dropped by the cost cap). Scores are relative to the best in the set
    (best/value for cost and days, value/best for on-time rate; 1.0 = best on that axis); ratio scaling
    keeps one outlier from squashing the gaps between the others. Ties break on reliability, then cost."""
    if not options:
        return [], []
    pr = priority if priority in WEIGHTS else "Balanced"
    cap = COST_CAP[pr]
    cheapest = min(o.cost_gbp for o in options)
    dropped = [o for o in options if cap is not None and o.cost_gbp > cheapest * cap]
    kept = [o for o in options if o not in dropped]          # the cheapest option always survives
    wc, ws, wr = WEIGHTS[pr]
    best_cost = min(o.cost_gbp for o in kept)
    best_days = min(o.transit_days for o in kept)
    best_rel = max(o.lane.on_time_pct for o in kept)
    for o in kept:
        o.score = 100 * (wc * best_cost / o.cost_gbp
                         + ws * D(best_days) / D(o.transit_days)
                         + wr * o.lane.on_time_pct / best_rel)
    kept.sort(key=lambda o: (-o.score, -o.lane.on_time_pct, o.cost_gbp))
    return kept, dropped


def rank_detailed(s: Shipment, priority: Optional[str], card: list[Lane] = DEFAULT_RATE_CARD
                  ) -> tuple[list[Option], list[Option]]:
    """Rank only the services that can physically carry the load."""
    return rank_options([o for o in lane_options(s, card) if fits(s, o)], priority)


def rank(s: Shipment, priority: Optional[str], card: list[Lane] = DEFAULT_RATE_CARD) -> list[Option]:
    return rank_detailed(s, priority, card)[0]


def choose(s: Shipment, priority: Optional[str], card: list[Lane] = DEFAULT_RATE_CARD) -> Optional[Option]:
    """The service the seller's priority points to, ignoring weight limits. R-05 is judged against this one."""
    ranked, _ = rank_options(lane_options(s, card), priority)
    return ranked[0] if ranked else None


def _d(n: int, unit: str) -> str:
    return f"{abs(n)} {unit}{'' if abs(n) == 1 else 's'}"


def justify(s: Shipment, ranked: list[Option], priority: Optional[str],
            dropped: Optional[list[Option]] = None, all_options: Optional[list[Option]] = None) -> str:
    """Plain-language reason for the pick, with concrete trade-offs against the alternatives."""
    best, pr = ranked[0], priority if priority in WEIGHTS else "Balanced"
    lane = best.lane
    why = {"Cheapest": "it has the lowest price", "Fastest": "it has the shortest transit time",
           "Most reliable": "it has the highest on-time rate",
           "Balanced": "it gives the best trade-off of cost, speed and reliability"}[pr]
    parts = [f"{lane.label} is recommended for a '{pr}' priority because {why}: £{best.cost_gbp:,.2f} for "
             f"{s.pallets or 1} pallet(s), {_d(best.transit_days, 'day')} transit, {lane.on_time_pct:g}% on time."]
    cheapest = min(ranked, key=lambda o: o.cost_gbp)       # options dropped by the cap are explained below, not compared
    fastest = min(ranked, key=lambda o: (o.transit_days, o.cost_gbp))
    if best is not cheapest:
        extra = best.cost_gbp - cheapest.cost_gbp
        days = cheapest.transit_days - best.transit_days
        rel = best.lane.on_time_pct - cheapest.lane.on_time_pct
        gains = []
        if days > 0: gains.append(f"{_d(days, 'day')} faster")
        if rel > 0: gains.append(f"{rel:g} points more reliable")
        parts.append(f"It costs £{extra:,.2f} more than the cheapest option ({cheapest.lane.label})"
                     + (f" but is {' and '.join(gains)}." if gains else "."))
    if best is not fastest:
        parts.append(f"{fastest.lane.label} is quicker ({_d(fastest.transit_days, 'day')}) but costs "
                     f"£{fastest.cost_gbp - best.cost_gbp:,.2f} more.")
    for o in dropped or []:
        parts.append(f"{o.lane.label} ({_d(o.transit_days, 'day')}, £{o.cost_gbp:,.2f}) was not considered because it costs "
                     f"more than {COST_CAP[pr]}x the cheapest option. Choose 'Fastest' to include premium services.")
    pp = per_pallet_kg(s)
    for o in (all_options or []):
        if pp is not None and pp > o.lane.max_pallet_kg:
            parts.append(f"{o.lane.label} is excluded: {pp:.0f} kg per pallet is over its {o.lane.max_pallet_kg:g} kg limit.")
    return " ".join(parts)
