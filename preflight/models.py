"""Domain models. Money and weights use Decimal to avoid float drift on the 1% check."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from enum import Enum
from typing import Optional

DESTINATIONS = {"Germany", "France", "Netherlands"}
DEST_TYPES = {"Warehouse", "Business address"}
PRIORITIES = {"Cheapest", "Fastest", "Most reliable", "Balanced"}


class Severity(str, Enum):
    RED = "Red"      # blocks booking
    AMBER = "Amber"  # warns; seller may override after acknowledging


@dataclass
class Item:
    sku: str
    description: Optional[str] = None
    hs_code: Optional[str] = None
    quantity: Optional[int] = None
    unit_price_gbp: Optional[Decimal] = None
    units_per_carton: Optional[int] = None
    cartons: Optional[int] = None
    unit_weight_kg: Optional[Decimal] = None
    country_of_origin: Optional[str] = None


@dataclass
class Shipment:
    destination_country: Optional[str] = None
    destination_type: Optional[str] = None
    delivery_appointment_booked: Optional[str] = None  # "Yes" | "No" | None
    ready_date: Optional[date] = None
    pallets: Optional[int] = None
    total_cartons: Optional[int] = None
    total_gross_weight_kg: Optional[Decimal] = None
    total_declared_value_gbp: Optional[Decimal] = None
    priority: Optional[str] = None
    # Reference data from the booking form; never asked for in chat, shown in summaries.
    booking_id: Optional[str] = None
    seller_name: Optional[str] = None
    origin_city: Optional[str] = None
    origin_country: Optional[str] = None
    destination_city: Optional[str] = None
    items: list[Item] = field(default_factory=list)


@dataclass
class Finding:
    rule_id: str
    severity: Severity
    title: str
    detail: str            # what we saw, with the numbers
    fix: str               # what the seller should do
    field: str             # machine-readable pointer, e.g. "items[SKU1].hs_code"

    def to_dict(self) -> dict:
        return {**self.__dict__, "severity": self.severity.value}
