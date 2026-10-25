"""Rules R-01..R-10, carrier matching against the fixed rate card, and the conversation state machine."""
import json
from datetime import date
from decimal import Decimal as D

from preflight import Conversation, Item, Shipment, preflight
from preflight.carriers import DEFAULT_RATE_CARD, rank_detailed

TODAY = date(2026, 10, 25)


def good() -> Shipment:
    return Shipment(
        destination_country="Germany", destination_type="Warehouse", delivery_appointment_booked="Yes",
        ready_date=date(2026, 10, 28), pallets=2, total_cartons=30, total_gross_weight_kg=D(520),
        total_declared_value_gbp=D(6000), priority="Balanced",
        items=[Item("A", "cotton t-shirts", "610910", 1000, D(3), 50, 20, D("0.2"), "India"),
               Item("B", "ceramic mugs", "6912.00", 500, D(6), 50, 10, D("0.4"), "China")])


def ids(r):
    return sorted(f.rule_id for f in r.errors + r.warnings)


def test_rate_card_is_the_fixed_one():
    assert len(DEFAULT_RATE_CARD) == 9
    a = next(l for l in DEFAULT_RATE_CARD if l.name == "Carrier A" and l.destination == "Germany")
    assert (a.price_per_pallet, a.transit_days, a.on_time_pct, a.max_pallet_kg) == (180, 5, 92, 500)
    c = next(l for l in DEFAULT_RATE_CARD if l.name == "Carrier C" and l.destination == "Netherlands")
    assert (c.price_per_pallet, c.max_pallet_kg) == (320, 400)


def test_clean():
    r = preflight(good(), TODAY)
    assert r.status == "READY" and ids(r) == [] and r.recommendation


def test_each_rule_fires():
    cases = {
        "R-01": lambda s: setattr(s.items[0], "hs_code", "6109"),
        "R-02": lambda s: setattr(s, "total_declared_value_gbp", D(6061)),  # 1.02% off
        "R-03": lambda s: setattr(s.items[0], "units_per_carton", 40),
        "R-04": lambda s: setattr(s, "total_cartons", 31),
        "R-05": lambda s: setattr(s, "total_gross_weight_kg", D(2100)),     # 1050/pallet: nothing takes it
        "R-06": lambda s: setattr(s.items[0], "description", "Li-ion power bank"),
        "R-07": lambda s: setattr(s.items[0], "unit_weight_kg", D("0.9")),  # goods 1100 kg > gross 520
        "R-08": lambda s: setattr(s, "delivery_appointment_booked", "No"),
        "R-09": lambda s: setattr(s.items[1], "country_of_origin", None),
        "R-10": lambda s: setattr(s, "ready_date", date(2026, 10, 1)),
    }
    for rid, mutate in cases.items():
        s = good()
        mutate(s)
        assert rid in ids(preflight(s, TODAY)), rid


def test_blank_hs_code_is_red_in_strict_mode_only():
    s = good(); s.items[0].hs_code = None
    assert "R-01" in ids(preflight(s, TODAY, strict=True))
    assert "R-01" not in ids(preflight(s, TODAY, strict=False))      # draft: not asked for yet


def test_value_tolerance_boundary():
    s = good(); s.total_declared_value_gbp = D("6060")       # exactly 1% -> pass
    assert "R-02" not in ids(preflight(s, TODAY))
    s.total_declared_value_gbp = D("5939.99")                # just over 1% -> fail
    assert "R-02" in ids(preflight(s, TODAY))


def test_r05_is_judged_against_the_chosen_carrier():
    s = good(); s.total_gross_weight_kg = D(1100)            # 550 kg/pallet
    s.priority = "Balanced"                                  # chosen = B (750): fine
    assert "R-05" not in ids(preflight(s, TODAY))
    s.priority = "Cheapest"                                  # chosen = A (500): too heavy, but B can take it
    r = preflight(s, TODAY)
    f = next(f for f in r.errors if f.rule_id == "R-05")
    assert "Carrier A" in f.detail and "Carrier B" in f.fix and "3 pallets" in f.fix
    assert r.status == "BLOCKED" and r.recommendation.lane.name == "Carrier B" and r.provisional
    s.priority = "Fastest"                                   # chosen = C (400): too heavy
    assert "R-05" in ids(preflight(s, TODAY))


def test_r05_boundary_and_nothing_fits():
    s = good(); s.priority = "Balanced"; s.total_gross_weight_kg = D(1500)   # exactly 750/pallet on B
    assert "R-05" not in ids(preflight(s, TODAY))
    s.total_gross_weight_kg = D(1502)
    r = preflight(s, TODAY)
    f = next(f for f in r.errors if f.rule_id == "R-05")
    assert "No service on this route" in f.fix and r.recommendation is None


def test_dg_no_false_positive():
    s = good(); s.items[0].description = "delighted gift set"
    assert "R-06" not in ids(preflight(s, TODAY))
    for d in ("Aerosol deodorant spray", "Flammable paint thinner 1L", "Lithium-ion battery pack"):
        s.items[0].description = d
        assert "R-06" in ids(preflight(s, TODAY)), d


def test_priority_changes_pick():
    picks = {}
    for p in ("Cheapest", "Fastest", "Most reliable", "Balanced"):
        s = good(); s.priority = p
        picks[p] = preflight(s, TODAY).recommendation.lane.name
    assert picks == {"Cheapest": "Carrier A", "Fastest": "Carrier C", "Most reliable": "Carrier C",
                     "Balanced": "Carrier B"}, picks


def test_cost_cap_keeps_express_out_of_balanced_and_cheapest():
    for p in ("Balanced", "Cheapest"):
        s = good(); s.priority = p
        ranked, dropped = rank_detailed(s, p)
        assert [o.lane.name for o in dropped] == ["Carrier C"] and "Carrier C" not in {o.lane.name for o in ranked}
    s = good(); s.priority = "Fastest"
    assert rank_detailed(s, "Fastest")[1] == []              # speed is the stated intent: uncapped


def test_justification_is_concrete():
    s = good(); s.priority = "Balanced"
    why = preflight(s, TODAY).justification
    assert "Carrier B (Road standard)" in why and "£440.00" in why and "3 days" in why
    assert "Carrier A" in why and "£80.00 more" in why        # trade-off vs the cheapest option
    s.total_gross_weight_kg = D(1000)                          # 500/pallet: Carrier C (400) excluded by weight
    assert "excluded" in preflight(s, TODAY).justification


def test_cost_scales_with_pallets():
    s = good(); s.priority = "Cheapest"; s.pallets = 5; s.total_gross_weight_kg = D(800)
    assert preflight(s, TODAY).recommendation.cost_gbp == D(900)


def test_report_is_json_serialisable_and_has_next_steps():
    r = preflight(good(), TODAY)
    json.dumps(r.to_dict())
    assert "What happens next" in r.summary and "collects from" in r.summary


# ---------------------------------------------------------------- conversation
def scripted(*turns):
    it = iter(turns)
    return lambda text, snap, today: next(it)


def test_conversation_flow():
    S = lambda f, v: {"op": "set", "field": f, "value": v}
    conv = Conversation(scripted(
        [S("destination_country", "germany"), S("destination_type", "warehouse"), S("pallets", 2),
         {"op": "upsert_item", "sku": "A", "fields": {"description": "cotton t-shirts", "hs_code": "6109", "quantity": 1000,
          "unit_price_gbp": "3", "units_per_carton": 50, "cartons": 20, "unit_weight_kg": "0.2"}}],
        [S("ready_date", "28-10-2026"), S("total_gross_weight_kg", 900), S("total_cartons", 20),
         S("total_declared_value_gbp", 3000), S("priority", "cheapest"),
         {"op": "upsert_item", "sku": "A", "fields": {"country_of_origin": "India"}},
         S("delivery_appointment_booked", "yes")],
        [],                                                   # a turn with no usable ops must not confirm anything
        [{"op": "increment", "field": "pallets", "value": 1}],
        [S("total_gross_weight_kg", 1300)],
        [{"op": "upsert_item", "sku": "A", "fields": {"hs_code": "6109.10"}}],
        [{"op": "confirm"}],
    ), today=TODAY)

    r1 = conv.turn("...")
    assert "ready" in r1.lower() and conv.phase.value == "collecting" and "Heads-up" in r1
    r2 = conv.turn("...")
    assert conv.phase.value == "confirming" and "HS code too short" in r2
    conv.turn("hmm")
    assert conv.phase.value == "confirming"
    r3 = conv.turn("add a pallet")
    assert conv.phase.value == "collecting" and "still right" in r3 and conv.shipment.pallets == 3
    r4 = conv.turn("weight is now 1300")
    assert "HS code too short" in r4
    conv.turn("hs is 6109.10")
    assert conv.last_report.status == "READY", conv.last_report.status
    assert conv.turn("confirm").startswith("Booked with Carrier A") and conv.phase.value == "booked"


def test_hs_code_is_asked_once_then_flagged_red_if_declined():
    S = lambda f, v: {"op": "set", "field": f, "value": v}
    item = {"op": "upsert_item", "sku": "A", "fields": {"description": "mugs", "quantity": 10, "unit_price_gbp": 5,
            "units_per_carton": 5, "cartons": 2, "unit_weight_kg": 1, "country_of_origin": "China"}}
    conv = Conversation(scripted(
        [S("destination_country", "France"), S("destination_type", "Business address"), S("ready_date", "30-10-2026"),
         S("pallets", 1), S("total_gross_weight_kg", 20), S("total_cartons", 2), S("total_declared_value_gbp", 50),
         S("priority", "Balanced"), item],
        [{"op": "decline", "field": "hs_code"}]), today=TODAY)
    assert "HS (customs) code" in conv.turn("x")
    conv.turn("unknown")
    assert conv.last_report.status == "BLOCKED" and "R-01" in ids(conv.last_report)


def test_bad_patch_is_contained():
    conv = Conversation(scripted([{"op": "set", "field": "destination_country", "value": "Spain"},
                                  {"op": "set", "field": "pallets", "value": "-3"},
                                  {"op": "set", "field": "destination_type", "value": "Residential"},
                                  {"op": "set", "field": "ready_date", "value": "next week"}]), today=TODAY)
    r = conv.turn("x")
    s = conv.shipment
    assert s.destination_country is None and s.pallets is None and s.destination_type is None and s.ready_date is None
    assert r.count("Couldn't use") == 4


def test_dates_and_hs_codes_from_spreadsheets():
    from preflight.conversation import _coerce
    from datetime import datetime
    assert _coerce("ready_date", "05-11-2026") == date(2026, 11, 5)
    assert _coerce("ready_date", "2026-11-05") == date(2026, 11, 5)
    assert _coerce("ready_date", datetime(2026, 11, 5, 0, 0)) == date(2026, 11, 5)
    assert _coerce("hs_code", 691200.0) == "691200" and _coerce("hs_code", "691200.0") == "691200"
    assert _coerce("hs_code", "6912.00") == "6912.00"
    assert _coerce("destination_type", "business address") == "Business address"


if __name__ == "__main__":
    import sys
    fails = 0
    for n, f in list(globals().items()):
        if n.startswith("test_"):
            try:
                f(); print("PASS", n)
            except Exception as e:
                import traceback; traceback.print_exc(); print("FAIL", n, repr(e)); fails += 1
    sys.exit(fails)
