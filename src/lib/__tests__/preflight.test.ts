// Rules R-01..R-10, carrier matching against the fixed rate card, and the conversation state machine.
import { describe, expect, it } from "vitest";
import { DEFAULT_RATE_CARD, rankDetailed } from "../engine/carriers";
import { Conversation, coerce, type Op } from "../engine/conversation";
import { newItem, newShipment, type Shipment } from "../engine/models";
import { preflight } from "../engine/report";

const TODAY = "2026-10-25";

const good = (): Shipment => ({
  ...newShipment(),
  destination_country: "Germany", destination_type: "Warehouse", delivery_appointment_booked: "Yes",
  ready_date: "2026-10-28", pallets: 2, total_cartons: 30, total_gross_weight_kg: "520",
  total_declared_value_gbp: "6000", priority: "Balanced",
  items: [
    { ...newItem("A"), description: "cotton t-shirts", hs_code: "610910", quantity: 1000, unit_price_gbp: "3", units_per_carton: 50, cartons: 20, unit_weight_kg: "0.2", country_of_origin: "India" },
    { ...newItem("B"), description: "ceramic mugs", hs_code: "6912.00", quantity: 500, unit_price_gbp: "6", units_per_carton: 50, cartons: 10, unit_weight_kg: "0.4", country_of_origin: "China" },
  ],
});

const ids = (r: ReturnType<typeof preflight>) => [...r.red, ...r.amber].map((f) => f.rule_id).sort();

describe("rate card and clean booking", () => {
  it("is the fixed case rate card", () => {
    expect(DEFAULT_RATE_CARD).toHaveLength(9);
    const a = DEFAULT_RATE_CARD.find((l) => l.name === "Carrier A" && l.destination === "Germany")!;
    expect([a.price_per_pallet.toNumber(), a.transit_days, a.on_time_pct.toNumber(), a.max_pallet_kg.toNumber()]).toEqual([180, 5, 92, 500]);
    const c = DEFAULT_RATE_CARD.find((l) => l.name === "Carrier C" && l.destination === "Netherlands")!;
    expect([c.price_per_pallet.toNumber(), c.max_pallet_kg.toNumber()]).toEqual([320, 400]);
  });

  it("passes a clean booking", () => {
    const r = preflight(good(), TODAY);
    expect(r.status).toBe("READY");
    expect(ids(r)).toEqual([]);
    expect(r.recommended_carrier).not.toBeNull();
  });
});

describe("rules", () => {
  it("each rule fires", () => {
    const cases: Record<string, (s: Shipment) => void> = {
      "R-01": (s) => { s.items[0].hs_code = "6109"; },
      "R-02": (s) => { s.total_declared_value_gbp = "6061"; }, // 1.02% off
      "R-03": (s) => { s.items[0].units_per_carton = 40; },
      "R-04": (s) => { s.total_cartons = 31; },
      "R-05": (s) => { s.total_gross_weight_kg = "2100"; }, // 1050/pallet: nothing takes it
      "R-06": (s) => { s.items[0].description = "Li-ion power bank"; },
      "R-07": (s) => { s.items[0].unit_weight_kg = "0.9"; }, // goods 1100 kg > gross 520
      "R-08": (s) => { s.delivery_appointment_booked = "No"; },
      "R-09": (s) => { s.items[1].country_of_origin = null; },
      "R-10": (s) => { s.ready_date = "2026-10-01"; },
    };
    for (const [rid, mutate] of Object.entries(cases)) {
      const s = good();
      mutate(s);
      expect(ids(preflight(s, TODAY)), rid).toContain(rid);
    }
  });

  it("blank HS code is Red in strict mode only", () => {
    const s = good(); s.items[0].hs_code = null;
    expect(ids(preflight(s, TODAY, true))).toContain("R-01");
    expect(ids(preflight(s, TODAY, false))).not.toContain("R-01"); // draft: not asked for yet
  });

  it("R-02 tolerance boundary", () => {
    const s = good(); s.total_declared_value_gbp = "6060"; // exactly 1% -> pass
    expect(ids(preflight(s, TODAY))).not.toContain("R-02");
    s.total_declared_value_gbp = "5939.99"; // just over 1% -> fail
    expect(ids(preflight(s, TODAY))).toContain("R-02");
  });

  it("R-05 is judged against the chosen carrier", () => {
    const s = good(); s.total_gross_weight_kg = "1100"; // 550 kg/pallet
    s.priority = "Balanced"; // chosen = B (750): fine
    expect(ids(preflight(s, TODAY))).not.toContain("R-05");
    s.priority = "Cheapest"; // chosen = A (500): too heavy, but B can take it
    const r = preflight(s, TODAY);
    const f = r.red.find((x) => x.rule_id === "R-05")!;
    expect(f.detail).toContain("Carrier A");
    expect(f.fix).toContain("Carrier B");
    expect(f.fix).toContain("3 pallets");
    expect(r.status).toBe("BLOCKED");
    expect(r.recommended_carrier!.carrier).toBe("Carrier B");
    expect(r.provisional).toBe(true);
    s.priority = "Fastest"; // chosen = C (400): too heavy
    expect(ids(preflight(s, TODAY))).toContain("R-05");
  });

  it("R-05 boundary and nothing fits", () => {
    const s = good(); s.priority = "Balanced"; s.total_gross_weight_kg = "1500"; // exactly 750/pallet on B
    expect(ids(preflight(s, TODAY))).not.toContain("R-05");
    s.total_gross_weight_kg = "1502";
    const r = preflight(s, TODAY);
    expect(r.red.find((x) => x.rule_id === "R-05")!.fix).toContain("No service on this route");
    expect(r.recommended_carrier).toBeNull();
  });

  it("R-06 has no false positives and catches the real thing", () => {
    const s = good(); s.items[0].description = "delighted gift set";
    expect(ids(preflight(s, TODAY))).not.toContain("R-06");
    for (const d of ["Aerosol deodorant spray", "Flammable paint thinner 1L", "Lithium-ion battery pack"]) {
      s.items[0].description = d;
      expect(ids(preflight(s, TODAY)), d).toContain("R-06");
    }
  });
});

describe("carrier matching", () => {
  it("priority changes the pick", () => {
    const picks: Record<string, string> = {};
    for (const p of ["Cheapest", "Fastest", "Most reliable", "Balanced"]) {
      const s = good(); s.priority = p;
      picks[p] = preflight(s, TODAY).recommended_carrier!.carrier;
    }
    expect(picks).toEqual({ Cheapest: "Carrier A", Fastest: "Carrier C", "Most reliable": "Carrier C", Balanced: "Carrier B" });
  });

  it("cost cap keeps express out of Balanced and Cheapest", () => {
    for (const p of ["Balanced", "Cheapest"]) {
      const s = good(); s.priority = p;
      const [ranked, dropped] = rankDetailed(s, p);
      expect(dropped.map((o) => o.lane.name)).toEqual(["Carrier C"]);
      expect(ranked.map((o) => o.lane.name)).not.toContain("Carrier C");
    }
    const s = good(); s.priority = "Fastest";
    expect(rankDetailed(s, "Fastest")[1]).toEqual([]); // speed is the stated intent: uncapped
  });

  it("justification is concrete", () => {
    const s = good(); s.priority = "Balanced";
    const why = preflight(s, TODAY).justification;
    expect(why).toContain("Carrier B (Road standard)");
    expect(why).toContain("£440.00");
    expect(why).toContain("3 days");
    expect(why).toContain("£80.00 more"); // trade-off vs the cheapest option
    s.total_gross_weight_kg = "1000"; // 500/pallet: Carrier C (400) excluded by weight
    expect(preflight(s, TODAY).justification).toContain("excluded");
  });

  it("cost scales with pallets", () => {
    const s = good(); s.priority = "Cheapest"; s.pallets = 5; s.total_gross_weight_kg = "800";
    expect(preflight(s, TODAY).recommended_carrier!.cost_gbp).toBe(900);
  });

  it("report is JSON-serialisable and has next steps", () => {
    const r = preflight(good(), TODAY);
    expect(() => JSON.stringify(r)).not.toThrow();
    expect(r.summary).toContain("What happens next");
    expect(r.summary).toContain("collects from");
  });
});

const scripted = (...turns: Op[][]) => {
  const it = turns[Symbol.iterator]();
  return async () => it.next().value as Op[];
};
const S = (field: string, value: unknown): Op => ({ op: "set", field, value });

describe("conversation", () => {
  it("runs a full booking with a mid-conversation edit", async () => {
    const conv = new Conversation(scripted(
      [S("destination_country", "germany"), S("destination_type", "warehouse"), S("pallets", 2),
        { op: "upsert_item", sku: "A", fields: { description: "cotton t-shirts", hs_code: "6109", quantity: 1000, unit_price_gbp: "3", units_per_carton: 50, cartons: 20, unit_weight_kg: "0.2" } }],
      [S("ready_date", "28-10-2026"), S("total_gross_weight_kg", 900), S("total_cartons", 20), S("total_declared_value_gbp", 3000), S("priority", "cheapest"),
        { op: "upsert_item", sku: "A", fields: { country_of_origin: "India" } }, S("delivery_appointment_booked", "yes")],
      [], // a turn with no usable ops must not confirm anything
      [{ op: "increment", field: "pallets", value: 1 }],
      [S("total_gross_weight_kg", 1300)],
      [{ op: "upsert_item", sku: "A", fields: { hs_code: "6109.10" } }],
      [{ op: "confirm" }],
    ), TODAY);

    const r1 = await conv.turn("...");
    expect(r1.toLowerCase()).toContain("ready");
    expect(conv.phase).toBe("collecting");
    expect(r1).toContain("Heads-up");
    const r2 = await conv.turn("...");
    expect(conv.phase).toBe("confirming");
    expect(r2).toContain("HS code too short");
    await conv.turn("hmm");
    expect(conv.phase).toBe("confirming");
    const r3 = await conv.turn("add a pallet");
    expect(conv.phase).toBe("collecting");
    expect(r3).toContain("still right");
    expect(conv.shipment.pallets).toBe(3);
    expect(await conv.turn("weight is now 1300")).toContain("HS code too short");
    await conv.turn("hs is 6109.10");
    expect(conv.lastReport!.status).toBe("READY");
    expect((await conv.turn("confirm")).startsWith("Booked with Carrier A")).toBe(true);
    expect(conv.phase).toBe("booked");
  });

  it("asks the HS code once, then flags it Red if declined", async () => {
    const item: Op = { op: "upsert_item", sku: "A", fields: { description: "mugs", quantity: 10, unit_price_gbp: 5, units_per_carton: 5, cartons: 2, unit_weight_kg: 1, country_of_origin: "China" } };
    const conv = new Conversation(scripted(
      [S("destination_country", "France"), S("destination_type", "Business address"), S("ready_date", "30-10-2026"), S("pallets", 1),
        S("total_gross_weight_kg", 20), S("total_cartons", 2), S("total_declared_value_gbp", 50), S("priority", "Balanced"), item],
      [{ op: "decline", field: "hs_code" }]), TODAY);
    expect(await conv.turn("x")).toContain("HS (customs) code");
    await conv.turn("unknown");
    expect(conv.lastReport!.status).toBe("BLOCKED");
    expect(ids(conv.lastReport!)).toContain("R-01");
  });

  it("contains a bad patch", async () => {
    const conv = new Conversation(scripted([S("destination_country", "Spain"), S("pallets", "-3"), S("destination_type", "Residential"), S("ready_date", "next week")]), TODAY);
    const r = await conv.turn("x");
    const s = conv.shipment;
    expect([s.destination_country, s.pallets, s.destination_type, s.ready_date]).toEqual([null, null, null, null]);
    expect(r.match(/Couldn't use/g)).toHaveLength(4);
  });

  it("survives an extractor failure without changing state", async () => {
    const { ExtractorError } = await import("../engine/conversation");
    const conv = new Conversation(async () => { throw new ExtractorError("boom"); }, TODAY);
    expect(await conv.turn("hello")).toContain("Nothing was changed");
    expect(conv.shipment.pallets).toBeNull();
  });

  it("state round-trips through JSON (the API is stateless)", async () => {
    const a = new Conversation(scripted([S("destination_country", "France"), S("pallets", 2)], [S("priority", "Fastest")]), TODAY);
    await a.turn("x");
    const b = new Conversation(scripted([S("priority", "Fastest")]), TODAY, JSON.parse(JSON.stringify(a.toState())));
    await b.turn("y");
    expect([b.shipment.destination_country, b.shipment.pallets, b.shipment.priority]).toEqual(["France", 2, "Fastest"]);
  });

  it("coerces dates and HS codes from spreadsheets", () => {
    expect(coerce("ready_date", "05-11-2026")).toBe("2026-11-05");
    expect(coerce("ready_date", "2026-11-05")).toBe("2026-11-05");
    expect(coerce("ready_date", new Date(Date.UTC(2026, 10, 5)))).toBe("2026-11-05");
    expect(coerce("hs_code", 691200)).toBe("691200");
    expect(coerce("hs_code", "691200.0")).toBe("691200");
    expect(coerce("hs_code", "6912.00")).toBe("6912.00");
    expect(coerce("destination_type", "business address")).toBe("Business address");
    expect(() => coerce("ready_date", "31-02-2026")).toThrow();
  });
});
