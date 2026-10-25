"""Regenerates samples/test_bookings_items.xlsx (+ CSV pair) in the official template layout:
title row, header row, then data. BK-001 is the template's own example row; BK-003..BK-010 each plant mistakes
for specific rules (see EXPECTED, which tests/test_batch.py asserts). Run: python samples/build_samples.py"""
import csv
import math
from datetime import datetime
from pathlib import Path

from openpyxl import Workbook

HERE = Path(__file__).parent
B_HEAD = ["Booking ID", "Seller name", "Origin city", "Origin country", "Destination city", "Destination country",
          "Destination type", "Ready to ship date", "Seller priority", "Pallets", "Cartons", "Total declared value",
          "Currency", "Total gross weight (kg)", "Delivery appointment booked"]
I_HEAD = ["Booking ID", "SKU", "Description", "HS code", "Quantity (units)", "Unit price", "Units per carton",
          "Cartons", "Unit weight (kg)", "Country of origin"]
UK = "United Kingdom"

# rule ids each booking is expected to trigger (exact set)
EXPECTED = {
    "BK-001": set(), "BK-002": set(), "BK-003": {"R-01"}, "BK-004": {"R-02"}, "BK-005": {"R-03", "R-04"},
    "BK-006": {"R-05"}, "BK-007": {"R-06"}, "BK-008": {"R-07"}, "BK-009": {"R-08", "R-09", "R-10"},
    "BK-010": {"R-01", "R-02", "R-04", "R-05", "R-06", "R-08", "R-09"},
}


def item(sku, desc, hs, qty, price, upc, cartons, wt, origin):
    return dict(sku=sku, desc=desc, hs=hs, qty=qty, price=price, upc=upc, cartons=cartons, wt=wt, origin=origin)


def booking(bid, seller, ocity, dcity, dcountry, dtype, ready, prio, pallets, items, appt, *,
            weight=None, declared=None, cartons=None):
    goods = sum(i["qty"] * i["wt"] for i in items)
    return dict(
        id=bid, seller=seller, ocity=ocity, dcity=dcity, dcountry=dcountry, dtype=dtype, ready=ready, prio=prio,
        pallets=pallets, appt=appt, items=items,
        cartons=cartons if cartons is not None else sum(i["cartons"] for i in items),
        declared=declared if declared is not None else sum(i["qty"] * i["price"] for i in items),
        weight=weight if weight is not None else math.ceil(goods * 1.08 + pallets * 25))


mug = item("MUG-01", "Ceramic coffee mug, 350 ml", 691200, 1080, 5, 12, 90, 0.5, UK)
tee = item("TSH-01", "Cotton t-shirt, assorted sizes", 610910, 600, 4, 20, 30, 0.25, "India")
sock = item("SOK-01", "Merino wool socks, pair", 611595, 800, 3.5, 40, 20, 0.12, "Turkey")
brk = item("BRK-01", "Steel shelf bracket set", 731815, 2000, 4, 50, 40, 0.55, "China")

BOOKINGS = [
    booking("BK-001", "Northfield Goods", "Manchester", "Frankfurt", "Germany", "Warehouse", "05-11-2026", "Cheapest",
            3, [mug], "Yes", declared=5400, weight=620),
    booking("BK-002", "Harbour Home Ltd", "London", "Paris", "France", "Business address", datetime(2026, 11, 9),
            "Balanced", 2, [tee, sock], "No"),
    booking("BK-003", "Kestrel Apparel", "Leeds", "Hamburg", "Germany", "Warehouse", "12-11-2026", "Cheapest", 2,
            [{**tee, "hs": None}, {**sock, "hs": 6115}], "Yes"),
    booking("BK-004", "Birch & Co", "Birmingham", "Amsterdam", "Netherlands", "Warehouse", "10-11-2026", "Fastest",
            2, [mug], "Yes", declared=6600),
    booking("BK-005", "Pennine Textiles", "Leeds", "Lyon", "France", "Business address", "11-11-2026", "Balanced", 2,
            [{**tee, "qty": 500, "upc": 20, "cartons": 20}, sock], "No", cartons=55),
    booking("BK-006", "Ironbridge Hardware", "Birmingham", "Berlin", "Germany", "Warehouse", "13-11-2026", "Cheapest",
            2, [brk], "Yes", weight=1300),
    booking("BK-007", "Volt & Spark", "London", "Lyon", "France", "Business address", "16-11-2026", "Balanced", 1,
            [item("PWR-01", "Li-ion portable power bank 10000mAh", 850760, 300, 9, 30, 10, 0.25, "China"),
             item("DEO-01", "Aerosol deodorant spray 150ml", 330720, 240, 2.5, 24, 10, 0.2, UK)], "No"),
    booking("BK-008", "Calder Crafts", "Manchester", "Rotterdam", "Netherlands", "Business address", "17-11-2026",
            "Most reliable", 1, [item("CND-01", "Soy wax candle, 200 g", 340600, 400, 6, 20, 20, 0.35, "Vietnam")],
            "No", weight=100),
    booking("BK-009", "Fenwick Foods", "London", "Amsterdam", "Netherlands", "Warehouse", "01-10-2026", "Fastest", 3,
            [item("JAM-01", "Strawberry jam jar, 340 g", 200799, 1200, 3, 24, 50, 0.45, "Turkey"),
             item("BSC-01", "Shortbread biscuit tin", 190590, 600, 4, 12, 50, 0.45, None)], "No"),
    booking("BK-010", "Magpie Trading", "Birmingham", "Hamburg", "Germany", "Warehouse", "18-11-2026", "Cheapest", 3,
            [item("THN-01", "Flammable paint thinner 1L", 3814, 600, 7, 12, 50, 1.0, "Germany"),
             item("GLU-01", "Contact adhesive tube", None, 1000, 2, 25, 40, 0.15, None)], "No",
            weight=2400, declared=8000, cartons=95),
]


def rows():
    b = [[x["id"], x["seller"], x["ocity"], UK, x["dcity"], x["dcountry"], x["dtype"], x["ready"], x["prio"],
          x["pallets"], x["cartons"], x["declared"], "GBP", x["weight"], x["appt"]] for x in BOOKINGS]
    i = [[x["id"], it["sku"], it["desc"], it["hs"], it["qty"], it["price"], it["upc"], it["cartons"], it["wt"],
          it["origin"]] for x in BOOKINGS for it in x["items"]]
    return b, i


def main():
    b, i = rows()
    wb = Workbook()
    for title, head, data, note in (("Bookings", B_HEAD, b, "Bookings"), ("Items", I_HEAD, i, "Items")):
        ws = wb.active if title == "Bookings" else wb.create_sheet(title)
        ws.title = title
        ws.append([f"{note} — one row per record. Row 3 is an example (grey); enter data from row 4."])
        ws.append(head)
        for r in data:
            ws.append(r)
    wb.save(HERE / "test_bookings_items.xlsx")
    for name, head, data in (("bookings.csv", B_HEAD, b), ("items.csv", I_HEAD, i)):
        with open(HERE / name, "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(head)
            w.writerows([[x.strftime("%d-%m-%Y") if isinstance(x, datetime) else ("" if x is None else x) for x in r]
                         for r in data])
    print(f"wrote {len(b)} bookings, {len(i)} items")


if __name__ == "__main__":
    main()
