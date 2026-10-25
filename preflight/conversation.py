"""Conversational state machine.

Division of labour: the LLM only *translates text into structured patch ops*. All state changes,
validation, arithmetic and decisions happen here in deterministic code, so the model can never
silently corrupt a shipment or skip a rule.

    user text --extractor(LLM)--> ops --apply_patch--> Shipment --> missing slots / stale totals
                                                           |--> live rules (strict=False)
                                                           '--> preflight (strict=True) when complete
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from enum import Enum
from typing import Callable, Optional

from .models import DESTINATIONS, DEST_TYPES, PRIORITIES, Item, Shipment
from .report import PreflightReport, collection_plan, context_for, preflight
from .rules import run_rules


class Phase(str, Enum):
    COLLECTING = "collecting"   # slots missing or totals stale
    CONFIRMING = "confirming"   # pre-flight shown, waiting for 'confirm' or corrections
    BOOKED = "booked"


# --- LLM contract -----------------------------------------------------------------------------
EXTRACTOR_SYSTEM_PROMPT = """You convert freight-booking chat messages into JSON patch ops. Output ONLY a JSON list.
Ops:
 {"op":"set","field":F,"value":V}          F in destination_country, destination_city, origin_city, seller_name,
                                           destination_type (Warehouse | Business address), delivery_appointment_booked,
                                           ready_date (YYYY-MM-DD; resolve 'tomorrow' / 'next Friday' using today's date given),
                                           pallets, total_cartons, total_gross_weight_kg, total_declared_value_gbp, priority
 {"op":"increment","field":"pallets","value":N}   for 'add a pallet' / 'one more pallet' (negative to remove)
 {"op":"upsert_item","sku":S,"fields":{description,hs_code,quantity,unit_price_gbp,units_per_carton,cartons,
                                       unit_weight_kg,country_of_origin}}   only fields the user stated; new item => new sku
 {"op":"remove_item","sku":S}
 {"op":"decline","field":F}               user doesn't know/refuses (only for optional fields)
 {"op":"keep","field":F}                  user confirms a flagged total is still correct
 {"op":"confirm"}                         user approves booking
Never invent values. Never convert currency: if not GBP, emit no op and say so via {"op":"note","text":...}.
Current state and today's date are provided in the user turn."""

Extractor = Callable[[str, dict, date], list[dict]]

# --- Slots ------------------------------------------------------------------------------------
SHIPMENT_SLOTS = [  # (field, question)
    ("destination_country", "Which country is it going to - Germany, France or Netherlands?"),
    ("destination_type", "Is the destination a Warehouse or a Business address?"),
    ("ready_date", "When will the goods be ready for collection (date)?"),
    ("pallets", "How many pallets?"),
    ("total_gross_weight_kg", "What's the total gross weight in kg (including packaging and pallets)?"),
    ("total_cartons", "How many cartons in total?"),
    ("total_declared_value_gbp", "What's the total declared value in GBP?"),
    ("priority", "What matters most: Cheapest, Fastest, Most reliable, or Balanced?"),
]
ITEM_SLOTS = [  # required per item
    ("description", "a description"), ("quantity", "the quantity"),
    ("unit_price_gbp", "the unit price in GBP"), ("units_per_carton", "units per carton"),
    ("cartons", "the number of cartons"), ("unit_weight_kg", "the unit weight in kg"),
]
# Asked once; if declined stays None and the rule (R-08 / R-09 Amber, R-01 Red) reports it.
OPTIONAL = {"delivery_appointment_booked", "country_of_origin", "hs_code"}

# When X changes, these shipment-level totals may no longer be true -> re-confirm with the user.
STALE_ON = {
    "pallets": {"total_gross_weight_kg"},
    "items+": {"total_cartons", "total_declared_value_gbp", "total_gross_weight_kg"},
    "items-": {"total_cartons", "total_declared_value_gbp", "total_gross_weight_kg"},
    "quantity": {"total_declared_value_gbp", "total_gross_weight_kg"},
    "unit_price_gbp": {"total_declared_value_gbp"},
    "cartons": {"total_cartons"},
    "unit_weight_kg": {"total_gross_weight_kg"},
}

META_FIELDS = {"booking_id", "seller_name", "origin_city", "origin_country", "destination_city"}
_DEC = {"total_gross_weight_kg", "total_declared_value_gbp", "unit_price_gbp", "unit_weight_kg"}
_INT = {"pallets", "total_cartons", "quantity", "units_per_carton", "cartons"}


class PatchError(ValueError):
    pass


class ExtractorError(RuntimeError):
    """Raised by an extractor when it cannot produce ops (API down, refusal, unparseable output)."""


def _coerce(name: str, v):
    if v is None:
        raise PatchError(f"{name}: empty value")
    try:
        if name in _DEC:
            d = Decimal(str(v).replace(",", "").replace("£", "").strip())
            if d < 0:
                raise PatchError(f"{name}: must not be negative")
            return d
        if name in _INT:
            i = int(Decimal(str(v)))
            if i <= 0:
                raise PatchError(f"{name}: must be at least 1")
            return i
        if name == "ready_date":
            if isinstance(v, datetime):
                return v.date()
            if isinstance(v, date):
                return v
            s = str(v).strip()[:10]
            for fmt in ("%d-%m-%Y", "%Y-%m-%d", "%d/%m/%Y", "%d.%m.%Y"):
                try:
                    return datetime.strptime(s, fmt).date()
                except ValueError:
                    pass
            raise PatchError(f"ready_date: couldn't read '{v}' (use DD-MM-YYYY)")
        if name == "hs_code":
            if isinstance(v, float) and v.is_integer():     # Excel stores 691200 as 691200.0
                v = int(v)
            return re.sub(r"^(\d+)\.0$", r"\1", str(v).strip())
        if name == "destination_country":
            c = str(v).strip().title()
            if c not in DESTINATIONS:
                raise PatchError(f"We only ship to Germany, France and the Netherlands (got '{v}').")
            return c
        if name == "destination_type":
            t = {"warehouse": "Warehouse", "business": "Business address",
                 "business address": "Business address"}.get(str(v).strip().lower())
            if t not in DEST_TYPES:
                raise PatchError("destination type must be 'Warehouse' or 'Business address'")
            return t
        if name == "priority":
            p = {x.lower(): x for x in PRIORITIES}.get(str(v).strip().lower())
            if not p:
                raise PatchError(f"priority must be one of {sorted(PRIORITIES)}")
            return p
        if name == "delivery_appointment_booked":
            s = str(v).strip().lower()
            if s in ("yes", "y", "true", "booked"): return "Yes"
            if s in ("no", "n", "false", "not booked"): return "No"
            raise PatchError("appointment must be Yes or No")
        return str(v).strip()
    except (InvalidOperation, ValueError) as e:
        if isinstance(e, PatchError):
            raise
        raise PatchError(f"{name}: couldn't read '{v}'")


@dataclass
class Conversation:
    extractor: Extractor
    today: date = field(default_factory=date.today)
    shipment: Shipment = field(default_factory=Shipment)
    phase: Phase = Phase.COLLECTING
    stale: set[str] = field(default_factory=set)
    declined: set[str] = field(default_factory=set)
    asked_optional: set[str] = field(default_factory=set)
    shown_warnings: set[tuple] = field(default_factory=set)
    last_report: Optional[PreflightReport] = None

    # ---------------------------------------------------------------- patching
    def apply_patch(self, ops: list[dict]) -> tuple[set[str], list[str], bool]:
        """Returns (touched fields, user-facing errors, confirm_requested). Bad ops are skipped, not fatal."""
        s, touched, errors, confirm = self.shipment, set(), [], False
        for op in ops:
            try:
                kind = op.get("op")
                if kind == "set":
                    f = op["field"]
                    if f not in {n for n, _ in SHIPMENT_SLOTS} | META_FIELDS | {"delivery_appointment_booked"}:
                        raise PatchError(f"unknown field {f}")
                    setattr(s, f, _coerce(f, op["value"]))
                    touched.add(f)
                elif kind == "increment":
                    if op.get("field") != "pallets":
                        raise PatchError("can only increment pallets")
                    new = (s.pallets or 0) + int(op["value"])
                    if new < 1: raise PatchError("pallets can't drop below 1")
                    s.pallets = new
                    self.stale |= STALE_ON["pallets"]      # weight/pallet changes; ask, don't assume
                elif kind == "upsert_item":
                    self._upsert(op["sku"], op.get("fields", {}), touched)
                elif kind == "remove_item":
                    before = len(s.items)
                    s.items = [i for i in s.items if i.sku != op["sku"]]
                    if len(s.items) == before: raise PatchError(f"no item {op['sku']}")
                    self.stale |= STALE_ON["items-"]
                elif kind == "decline":
                    if op["field"] not in OPTIONAL:
                        raise PatchError(f"{op['field']} is required")
                    self.declined.add(op["field"])
                elif kind == "keep":
                    self.stale.discard(op["field"])
                elif kind == "confirm":
                    confirm = True
                # "note" ops are informational for the reply layer and ignored here
            except (PatchError, KeyError, TypeError) as e:
                errors.append(str(e) if isinstance(e, PatchError) else f"couldn't apply {op!r}")
        self.stale -= touched   # explicitly (re)stated this turn => no longer stale
        return touched, errors, confirm

    def _upsert(self, sku: str, fields: dict, touched: set[str]):
        s = self.shipment
        item = next((i for i in s.items if i.sku == sku), None)
        if item is None:
            item = Item(sku=sku)
            s.items.append(item)
            self.stale |= STALE_ON["items+"]
        for k, v in fields.items():
            if not hasattr(item, k) or k == "sku":
                raise PatchError(f"unknown item field {k}")
            setattr(item, k, _coerce(k, v))
            self.stale |= STALE_ON.get(k, set())

    # ---------------------------------------------------------------- slot logic
    def missing(self) -> list[str]:
        """Questions for required slots still empty, in a stable order."""
        s, qs = self.shipment, []
        qs += [q for f, q in SHIPMENT_SLOTS if getattr(s, f) is None]
        if not s.items:
            qs.append("What are you shipping? Give me each product line: description, HS code, quantity, "
                      "unit price (GBP), units per carton, cartons, unit weight (kg).")
        for it in s.items:
            gaps = [label for f, label in ITEM_SLOTS if getattr(it, f) is None]
            if gaps:
                qs.append(f"For '{it.description or it.sku}', I still need: {', '.join(gaps)}.")
        if s.destination_type == "Warehouse" and s.delivery_appointment_booked is None \
                and "delivery_appointment_booked" not in self.declined:
            qs.append("Is a delivery appointment booked with the warehouse (Yes/No)?")
        for it in s.items:
            if it.hs_code is None and "hs_code" not in self.declined:
                qs.append(f"What's the HS (customs) code for '{it.description or it.sku}'? "
                          "(6+ digits; say 'unknown' to skip - it will be flagged as a blocking issue)")
        for it in s.items:
            if it.country_of_origin is None and f"origin:{it.sku}" not in self.declined \
                    and "country_of_origin" not in self.declined:
                qs.append(f"What's the country of origin for '{it.description or it.sku}'? (say 'unknown' to skip)")
        return qs

    def stale_questions(self) -> list[str]:
        s = self.shipment
        label = {"total_gross_weight_kg": f"total gross weight ({s.total_gross_weight_kg} kg)",
                 "total_cartons": f"total cartons ({s.total_cartons})",
                 "total_declared_value_gbp": f"total declared value (£{s.total_declared_value_gbp})"}
        return [f"Since that changed, is the {label[f]} still right? Give the new figure or say it's unchanged."
                for f in sorted(self.stale) if f in label and getattr(s, f) is not None]

    # ---------------------------------------------------------------- turn loop
    def turn(self, user_text: str) -> str:
        try:
            ops = self.extractor(user_text, self.snapshot(), self.today)
        except ExtractorError as e:
            return f"Sorry, I couldn't read that just now ({e}). Nothing was changed - please try again or rephrase."
        return self.handle_ops(ops)

    def handle_ops(self, ops: list[dict]) -> str:
        """Apply already-extracted ops and produce the reply. Also the entry point for non-chat input."""
        touched, errors, confirm = self.apply_patch(ops)
        data_changed = bool(touched) or any(o.get("op") not in ("confirm", "note", "keep") for o in ops)
        reply: list[str] = [f"(Couldn't use: {e})" for e in errors]

        if self.phase == Phase.BOOKED:
            return "This shipment is already booked. Start a new booking for anything else."
        if self.phase == Phase.CONFIRMING and data_changed:
            self.phase = Phase.COLLECTING            # any edit invalidates the shown pre-flight

        reply += self._heads_up()
        gaps = self.missing()
        stale = self.stale_questions()
        if gaps or stale:
            self.phase = Phase.COLLECTING
            asks = (stale + gaps)[:3]               # never interrogate: max 3 questions per turn
            reply.append("\n".join(asks))
            return "\n".join(reply)

        if self.phase == Phase.CONFIRMING and confirm and self.last_report and self.last_report.status != "BLOCKED":
            self.phase = Phase.BOOKED
            rec = self.last_report.recommendation
            return f"Booked with {rec.lane.label}. " + collection_plan(self.shipment, rec)

        self.last_report = preflight(self.shipment, self.today, strict=True)
        self.phase = Phase.CONFIRMING
        reply.append(self.last_report.summary)
        return "\n".join(reply)

    def _heads_up(self) -> list[str]:
        """Surface rule hits as soon as their inputs exist (e.g. banned goods) - once each."""
        out = []
        for f in self.live_findings():
            key = (f.rule_id, f.field, f.detail)
            if key not in self.shown_warnings and self.missing():   # final summary will list the rest
                self.shown_warnings.add(key)
                out.append(f"Heads-up [{f.severity.value}] {f.title}: {f.detail}")
        return out

    def live_findings(self):
        """Rule hits on what has been collected so far (draft mode: missing inputs are skipped, not flagged)."""
        return run_rules(self.shipment, context_for(self.shipment, self.today, False))

    def snapshot(self) -> dict:
        s = self.shipment
        return {"shipment": {k: str(v) for k, v in s.__dict__.items() if k != "items" and v is not None},
                "items": [{k: str(v) for k, v in i.__dict__.items() if v is not None} for i in s.items],
                "stale": sorted(self.stale), "phase": self.phase.value,
                "asking": self.stale_questions()[:3] or self.missing()[:3]}
