// Rulebook R-01..R-10. Each rule is a pure function (Shipment, Context) -> Finding[].
//
// Rules skip silently when their inputs are not collected yet (draft mode), so they can run after every
// conversational turn for live warnings. `ctx.strict` (final pre-flight) additionally treats a blank HS code
// or country of origin as a violation.
import type { Finding, Item, Shipment } from "./models";
import { D, Decimal, fixed, g, money } from "./util";

export interface Context {
  today: string; // ISO date
  strict: boolean;
  // Max permitted gross kg per pallet for the chosen carrier (null: nothing to judge against yet).
  carrier_max_pallet_kg: Decimal | null;
  carrier_label: string;
}

export const VALUE_TOLERANCE = D("0.01");

// Word-boundary patterns so "lighter fluid" hits but "delighted" does not.
export const DG_PATTERNS: Record<string, RegExp> = {
  "lithium battery": /\blithium\b|\bli[- ]?ion\b|\blipo\b|\bli[- ]?polymer\b|\bbattery pack\b|\bpower ?bank\b/,
  aerosol:
    /\baerosols?\b|\bspray cans?\b|\bspray paint\b|\bhair ?spray\b|\bdeodorant spray\b|\bpressuri[sz]ed (can|canister)s?\b|\bbutane\b|\bpropane\b/,
  "flammable liquid":
    /\bflammable\b|\bpetrol\b|\bgasoline\b|\bwhite spirit\b|\blighter fluid\b|\bmethylated spirits?\b|\bacetone\b|\bthinners?\b|\bnail polish remover\b|\bfuel\b/,
};

export const RULEBOOK: ReadonlyArray<readonly [string, string, "Red" | "Amber"]> = [
  ["R-01", "Every item must have an HS code of at least 6 digits", "Red"],
  ["R-02", "Total declared value must equal the sum of quantity × unit price across all items (within 1%)", "Red"],
  ["R-03", "For each item, units per carton × cartons must equal quantity", "Red"],
  ["R-04", "Total cartons on the booking must equal the sum of cartons across all items", "Red"],
  ["R-05", "Weight per pallet (total gross weight ÷ pallets) must not exceed the chosen carrier's max weight per pallet", "Red"],
  ["R-06", "No lithium batteries, aerosols or flammable liquids", "Red"],
  ["R-07", "Total gross weight must be at least the sum of unit weight × quantity across all items", "Amber"],
  ["R-08", "Shipments to a warehouse must have a delivery appointment booked", "Amber"],
  ["R-09", "Every item must have a country of origin", "Amber"],
  ["R-10", "Ready to ship date must not be in the past", "Amber"],
];

type Rule = (s: Shipment, ctx: Context) => Finding[];
const ref = (it: Item) => `items[${it.sku}]`;
const RED = "Red" as const;
const AMBER = "Amber" as const;

// ---------------------------------------------------------------- RED
const r01: Rule = (s, ctx) => {
  const out: Finding[] = [];
  for (const it of s.items) {
    if (it.hs_code === null && !ctx.strict) continue;
    const digits = (it.hs_code ?? "").replace(/[\s.\-]/g, "");
    if (!/^\d+$/.test(digits) || digits.length < 6) {
      out.push({
        rule_id: "R-01", severity: RED, title: "HS code too short or invalid",
        detail: `${it.sku}: HS code '${it.hs_code ?? ""}' is not at least 6 digits.`,
        fix: "Provide the full commodity code (6+ digits, e.g. 6109.10). Customs rejects shorter codes.",
        field: `${ref(it)}.hs_code`,
      });
    }
  }
  return out;
};

const r02: Rule = (s) => {
  if (s.total_declared_value_gbp === null || !s.items.length) return [];
  if (s.items.some((i) => i.quantity === null || i.unit_price_gbp === null)) return [];
  const computed = s.items.reduce((acc, i) => acc.plus(D(i.unit_price_gbp!).times(i.quantity!)), D(0));
  const declared = D(s.total_declared_value_gbp);
  const diff = declared.minus(computed).abs();
  // Tolerance is relative to the computed line-item total; computed == 0 requires an exact match.
  if (diff.greaterThan(computed.times(VALUE_TOLERANCE))) {
    const pct = computed.isZero() ? D(100) : diff.div(computed).times(100);
    return [{
      rule_id: "R-02", severity: RED, title: "Declared value does not match line items",
      detail: `Declared £${money(declared)} vs £${money(computed)} from quantity × unit price ` +
        `(off by £${money(diff)}, ${fixed(pct, 1)}%; limit 1%).`,
      fix: `Correct the total to £${money(computed)} or fix the quantities/unit prices.`,
      field: "total_declared_value_gbp",
    }];
  }
  return [];
};

const r03: Rule = (s) => {
  const out: Finding[] = [];
  for (const it of s.items) {
    if (it.units_per_carton === null || it.cartons === null || it.quantity === null) continue;
    const expected = it.units_per_carton * it.cartons;
    if (expected !== it.quantity) {
      out.push({
        rule_id: "R-03", severity: RED, title: "Units per carton × cartons ≠ quantity",
        detail: `${it.sku}: ${it.units_per_carton} × ${it.cartons} = ${expected}, but quantity is ${it.quantity}.`,
        fix: "Correct the quantity, units per carton or carton count so they agree.",
        field: `${ref(it)}.quantity`,
      });
    }
  }
  return out;
};

const r04: Rule = (s) => {
  if (s.total_cartons === null || !s.items.length || s.items.some((i) => i.cartons === null)) return [];
  const total = s.items.reduce((a, i) => a + i.cartons!, 0);
  if (total !== s.total_cartons) {
    return [{
      rule_id: "R-04", severity: RED, title: "Total cartons does not match items",
      detail: `Shipment says ${s.total_cartons} cartons; items add up to ${total}.`,
      fix: `Set total cartons to ${total}, or correct the per-item carton counts.`,
      field: "total_cartons",
    }];
  }
  return [];
};

const r05: Rule = (s, ctx) => {
  if (!s.pallets || s.total_gross_weight_kg === null || ctx.carrier_max_pallet_kg === null) return [];
  const perPallet = D(s.total_gross_weight_kg).div(s.pallets);
  if (perPallet.greaterThan(ctx.carrier_max_pallet_kg)) {
    const need = D(s.total_gross_weight_kg).div(ctx.carrier_max_pallet_kg).ceil();
    return [{
      rule_id: "R-05", severity: RED, title: "Pallet too heavy",
      detail: `${s.total_gross_weight_kg} kg over ${s.pallets} pallet(s) = ${fixed(perPallet, 0)} kg/pallet; ` +
        `${ctx.carrier_label} allows ${g(ctx.carrier_max_pallet_kg)} kg.`,
      fix: `Split the load across at least ${need.toString()} pallets, or choose a heavy-freight service.`,
      field: "pallets",
    }];
  }
  return [];
};

const r06: Rule = (s) => {
  const out: Finding[] = [];
  for (const it of s.items) {
    const text = (it.description ?? "").toLowerCase();
    for (const [label, pat] of Object.entries(DG_PATTERNS)) {
      if (pat.test(text)) {
        out.push({
          rule_id: "R-06", severity: RED, title: `Possible dangerous goods: ${label}`,
          detail: `${it.sku}: description '${it.description}' matches ${label} keywords.`,
          fix: "Standard freight cannot carry this. Remove the item, or book a certified ADR/DG service " +
            "with a UN number and safety data sheet.",
          field: `${ref(it)}.description`,
        });
        break;
      }
    }
  }
  return out;
};

// -------------------------------------------------------------- AMBER
const r07: Rule = (s) => {
  if (s.total_gross_weight_kg === null || !s.items.length) return [];
  if (s.items.some((i) => i.unit_weight_kg === null || i.quantity === null)) return [];
  const net = s.items.reduce((acc, i) => acc.plus(D(i.unit_weight_kg!).times(i.quantity!)), D(0));
  if (D(s.total_gross_weight_kg).lessThan(net)) {
    return [{
      rule_id: "R-07", severity: AMBER, title: "Gross weight lower than goods weight",
      detail: `Gross ${s.total_gross_weight_kg} kg is less than goods alone (${fixed(net, 1)} kg). ` +
        "Gross must include packaging and pallets.",
      fix: `Re-weigh; gross should be at least ${fixed(net, 1)} kg (typically goods + ~5-10% packaging + pallet).`,
      field: "total_gross_weight_kg",
    }];
  }
  return [];
};

const r08: Rule = (s) => {
  if (s.destination_type === "Warehouse" && s.delivery_appointment_booked !== "Yes") {
    return [{
      rule_id: "R-08", severity: AMBER, title: "No delivery appointment for warehouse",
      detail: "Destination is a warehouse and no delivery appointment is confirmed.",
      fix: "Book a slot with the consignee and give us the reference; otherwise delivery may be refused.",
      field: "delivery_appointment_booked",
    }];
  }
  return [];
};

const r09: Rule = (s, ctx) => {
  const out: Finding[] = [];
  for (const it of s.items) {
    if (it.country_of_origin === null && !ctx.strict) continue;
    if (!(it.country_of_origin ?? "").trim()) {
      out.push({
        rule_id: "R-09", severity: AMBER, title: "Country of origin missing",
        detail: `${it.sku} has no country of origin.`,
        fix: "Add the country of origin (where goods were made); needed for customs and duty.",
        field: `${ref(it)}.country_of_origin`,
      });
    }
  }
  return out;
};

const r10: Rule = (s, ctx) => {
  if (s.ready_date && s.ready_date < ctx.today) {
    return [{
      rule_id: "R-10", severity: AMBER, title: "Ready-to-ship date is in the past",
      detail: `Ready date ${s.ready_date} is before today (${ctx.today}).`,
      fix: "Pick today or a future date when the goods will really be ready for collection.",
      field: "ready_date",
    }];
  }
  return [];
};

export const RULES: ReadonlyArray<readonly [string, Rule]> = [
  ["R-01", r01], ["R-02", r02], ["R-03", r03], ["R-04", r04], ["R-05", r05],
  ["R-06", r06], ["R-07", r07], ["R-08", r08], ["R-09", r09], ["R-10", r10],
];

export function runRules(s: Shipment, ctx: Context): Finding[] {
  const findings: Finding[] = [];
  for (const [, fn] of RULES) findings.push(...fn(s, ctx));
  // Red first, then rule order: stable output for UI and tests.
  return findings.sort((a, b) => Number(a.severity !== RED) - Number(b.severity !== RED) || (a.rule_id < b.rule_id ? -1 : a.rule_id > b.rule_id ? 1 : 0));
}
