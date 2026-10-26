import { describe, expect, it } from "vitest";
import { proposeFix } from "../engine/autofix";
import { Conversation } from "../engine/conversation";

const TODAY = "2026-10-26";
const base = () => {
  const c = new Conversation(null, TODAY);
  c.applyPatch([
    { op: "set", field: "destination_country", value: "Germany" }, { op: "set", field: "destination_type", value: "Business address" },
    { op: "set", field: "ready_date", value: "2026-10-01" }, { op: "set", field: "pallets", value: 1 },
    { op: "set", field: "total_gross_weight_kg", value: "50" }, { op: "set", field: "total_cartons", value: 9 },
    { op: "set", field: "total_declared_value_gbp", value: "500" }, { op: "set", field: "priority", value: "Cheapest" },
    { op: "upsert_item", sku: "A", fields: { description: "T-shirts", hs_code: "610910", quantity: 100, unit_price_gbp: "10", units_per_carton: 10, cartons: 10, unit_weight_kg: "0.2", country_of_origin: "UK" } },
  ]);
  return c;
};

describe("auto-fix", () => {
  it("clears R-02, R-04 and R-10 with one patch each, and leaves R-01 to the human", () => {
    const c = base();
    const ids = () => c.liveFindings().map((f) => f.rule_id);
    expect(ids()).toEqual(expect.arrayContaining(["R-02", "R-04", "R-10"]));
    for (const rule of ["R-02", "R-04", "R-10"]) {
      const f = c.liveFindings().find((x) => x.rule_id === rule)!;
      const fix = proposeFix(c.shipment, f, TODAY)!;
      expect(fix).not.toBeNull();
      c.applyPatch(fix.ops);
      expect(ids()).not.toContain(rule);
    }
    const hs = { rule_id: "R-01", severity: "Red" as const, title: "", detail: "", fix: "", field: "items[A].hs_code" };
    expect(proposeFix(c.shipment, hs, TODAY)).toBeNull();
  });

  it("fixes R-03 by recomputing the quantity", () => {
    const c = base();
    c.applyPatch([{ op: "upsert_item", sku: "A", fields: { quantity: 95 } }]);
    const f = c.liveFindings().find((x) => x.rule_id === "R-03")!;
    c.applyPatch(proposeFix(c.shipment, f, TODAY)!.ops);
    expect(c.shipment.items[0].quantity).toBe(100);
  });
});
