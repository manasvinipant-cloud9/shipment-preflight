// The rate matrix (Window 3) and the rule ledger (Window 2).
import { describe, expect, it } from "vitest";
import { buildMatrix } from "../engine/carriers";
import { ledgerRows } from "../engine/ledger";
import { newItem, newShipment, type Shipment } from "../engine/models";
import { preflight } from "../engine/report";

const good = (): Shipment => ({
  ...newShipment(), destination_country: "Germany", destination_type: "Warehouse", delivery_appointment_booked: "Yes",
  ready_date: "2026-10-28", pallets: 2, total_cartons: 30, total_gross_weight_kg: "520", total_declared_value_gbp: "6000", priority: "Balanced",
  items: [
    { ...newItem("A"), description: "t-shirts", hs_code: "610910", quantity: 1000, unit_price_gbp: "3", units_per_carton: 50, cartons: 20, unit_weight_kg: "0.2", country_of_origin: "India" },
    { ...newItem("B"), description: "mugs", hs_code: "691200", quantity: 500, unit_price_gbp: "6", units_per_carton: 50, cartons: 10, unit_weight_kg: "0.4", country_of_origin: "China" },
  ],
});

describe("buildMatrix", () => {
  it("ranks by priority, caps cost outliers and shows the normalised cost ratio", () => {
    const m = buildMatrix(good(), "Balanced");
    expect(m.rows.map((r) => [r.carrier, r.status, r.rank])).toEqual([["Carrier B", "recommended", 1], ["Carrier A", "ranked", 2], ["Carrier C", "cost-capped", null]]);
    expect(m.rows[0].cost_ratio).toBeCloseTo(0.82, 2); // 360 / 440
    expect(m.rows[1].cost_ratio).toBe(1); // cheapest
    expect(m.rows[2].cost_ratio).toBeCloseTo(0.53, 2); // 360 / 680
    expect(m.rows[2].note).toContain("1.5x cost cap");
    expect(m.justification).toContain("Carrier B (Road standard)");
  });

  it("re-ranks for another priority (what-if) and lifts the cap for Fastest", () => {
    expect(buildMatrix(good(), "Cheapest").rows[0].carrier).toBe("Carrier A");
    const fast = buildMatrix(good(), "Fastest");
    expect(fast.rows[0].carrier).toBe("Carrier C");
    expect(fast.rows.some((r) => r.status === "cost-capped")).toBe(false);
  });

  it("excludes services that cannot carry the pallet weight", () => {
    const s = good(); s.total_gross_weight_kg = "1000"; // 500 kg per pallet
    const m = buildMatrix(s, "Fastest");
    const c = m.rows.find((r) => r.carrier === "Carrier C")!;
    expect(c.status).toBe("too-heavy");
    expect(c.note).toContain("500 kg per pallet is over its 400 kg limit");
    expect(m.rows[0].carrier).not.toBe("Carrier C");
  });

  it("handles a draft: no destination, and no service able to take the load", () => {
    expect(buildMatrix(newShipment(), null).rows).toEqual([]);
    const s = good(); s.total_gross_weight_kg = "2000"; // 1000 kg per pallet
    const m = buildMatrix(s, "Balanced");
    expect(m.rows.every((r) => r.status === "too-heavy")).toBe(true);
    expect(m.justification).toContain("No carrier on this route");
  });

  it("agrees with the pre-flight report's pick", () => {
    for (const p of ["Cheapest", "Fastest", "Most reliable", "Balanced"]) {
      const s = good(); s.priority = p;
      expect(buildMatrix(s, p).rows[0].carrier).toBe(preflight(s, "2026-10-26").recommended_carrier!.carrier);
    }
  });
});

describe("ledgerRows", () => {
  it("lists all ten rules; complete runs PASS clean rules, drafts leave them pending", () => {
    const s = good(); s.items[0].hs_code = "6109"; s.delivery_appointment_booked = "No";
    const r = preflight(s, "2026-10-26");
    const rows = ledgerRows([...r.red, ...r.amber], true);
    expect(rows).toHaveLength(10);
    expect(rows.find((x) => x.id === "R-01")!.stamp).toBe("RED");
    expect(rows.find((x) => x.id === "R-08")!.stamp).toBe("AMBER");
    expect(rows.find((x) => x.id === "R-02")!.stamp).toBe("PASS");
    expect(ledgerRows([...r.red, ...r.amber], false).find((x) => x.id === "R-02")!.stamp).toBe("PENDING");
    expect(rows.find((x) => x.id === "R-01")!.findings[0].fix).toContain("commodity code");
  });
});
