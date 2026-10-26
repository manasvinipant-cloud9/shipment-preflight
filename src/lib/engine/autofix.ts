// One-click remediation. For the findings that have exactly one arithmetic answer, build the JSON patch ops that
// make the rule pass. Findings that need a fact only the seller knows (HS code, dangerous goods, origin,
// appointment) return null: guessing those would hide a real problem, so they stay a human decision.
//
// The ops go through Conversation.applyPatch like any chat edit, so validation and re-checking are unchanged.
import type { Op } from "./conversation";
import type { Finding, Shipment } from "./models";
import { contextFor } from "./report";
import { D, fixed, money } from "./util";

export interface FixProposal {
  ops: Op[];
  /** Short button text, e.g. "Set declared value to £1,240.00". */
  label: string;
  /** One sentence for the audit trail in the chat log. */
  note: string;
}

const skuOf = (field: string) => /^items\[(.+)\]\./.exec(field)?.[1] ?? null;
const PACKAGING_UPLIFT = "1.08"; // goods + ~8% packaging and pallet, inside the 5-10% the R-07 fix text quotes

export function proposeFix(s: Shipment, f: Finding, today: string): FixProposal | null {
  switch (f.rule_id) {
    case "R-02": {
      if (!s.items.length || s.items.some((i) => i.quantity === null || i.unit_price_gbp === null)) return null;
      const total = s.items.reduce((a, i) => a.plus(D(i.unit_price_gbp!).times(i.quantity!)), D(0));
      return {
        ops: [{ op: "set", field: "total_declared_value_gbp", value: total.toFixed(2) }],
        label: `Set declared value to £${money(total)}`,
        note: `Declared value set to £${money(total)} (sum of quantity × unit price).`,
      };
    }
    case "R-03": {
      const sku = skuOf(f.field);
      const it = s.items.find((i) => i.sku === sku);
      if (!it || it.units_per_carton === null || it.cartons === null) return null;
      const qty = it.units_per_carton * it.cartons;
      return {
        ops: [{ op: "upsert_item", sku: it.sku, fields: { quantity: qty } }],
        label: `Set ${it.sku} quantity to ${qty}`,
        note: `${it.sku} quantity set to ${qty} (${it.units_per_carton} per carton × ${it.cartons} cartons).`,
      };
    }
    case "R-04": {
      if (!s.items.length || s.items.some((i) => i.cartons === null)) return null;
      const total = s.items.reduce((a, i) => a + i.cartons!, 0);
      return {
        ops: [{ op: "set", field: "total_cartons", value: total }],
        label: `Set total cartons to ${total}`,
        note: `Total cartons set to ${total} (sum of item cartons).`,
      };
    }
    case "R-05": {
      const max = contextFor(s, today, true).carrier_max_pallet_kg;
      if (!max || s.total_gross_weight_kg === null) return null;
      const need = D(s.total_gross_weight_kg).div(max).ceil().toNumber();
      if (!Number.isInteger(need) || need < 1) return null;
      return {
        ops: [{ op: "set", field: "pallets", value: need }],
        label: `Split across ${need} pallets`,
        note: `Pallets set to ${need} so each stays under the carrier's ${max.toString()} kg limit.`,
      };
    }
    case "R-07": {
      if (!s.items.length || s.items.some((i) => i.unit_weight_kg === null || i.quantity === null)) return null;
      const net = s.items.reduce((a, i) => a.plus(D(i.unit_weight_kg!).times(i.quantity!)), D(0));
      const gross = net.times(PACKAGING_UPLIFT).toDecimalPlaces(1, 0 /* round up */);
      return {
        ops: [{ op: "set", field: "total_gross_weight_kg", value: gross.toString() }],
        label: `Set gross weight to ${fixed(gross, 1)} kg`,
        note: `Gross weight set to ${fixed(gross, 1)} kg (goods ${fixed(net, 1)} kg + 8% packaging). Re-weigh to confirm.`,
      };
    }
    case "R-10":
      return {
        ops: [{ op: "set", field: "ready_date", value: today }],
        label: "Set ready date to today",
        note: `Ready date set to ${today}.`,
      };
    default:
      return null;
  }
}
