// Carrier eligibility, quoting, scoring and ranking against the fixed case rate card (Sheet 3).
//
// Cost = price per pallet x pallets. Hard filters (pallet weight) exclude a carrier outright; the seller's
// priority only re-weights the carriers that remain.
import type { Shipment } from "./models";
import { D, Decimal, fixed, g, money } from "./util";

export interface Lane {
  name: string;
  service: string;
  origin: string;
  destination: string;
  price_per_pallet: Decimal;
  transit_days: number;
  on_time_pct: Decimal;
  max_pallet_kg: Decimal;
}

export const laneLabel = (l: Lane) => `${l.name} (${l.service})`;

function buildCard(): Lane[] {
  const uk = "United Kingdom";
  const rows: Array<[string, string, number, number, number, Record<string, number>]> = [
    ["Carrier A", "Road economy", 5, 92, 500, { Germany: 180, France: 170, Netherlands: 160 }],
    ["Carrier B", "Road standard", 3, 95, 750, { Germany: 220, France: 210, Netherlands: 200 }],
    ["Carrier C", "Road express", 2, 98, 400, { Germany: 340, France: 330, Netherlands: 320 }],
  ];
  const out: Lane[] = [];
  for (const [name, service, days, ot, mx, prices] of rows)
    for (const [dest, price] of Object.entries(prices))
      out.push({ name, service, origin: uk, destination: dest, price_per_pallet: D(price), transit_days: days, on_time_pct: D(ot), max_pallet_kg: D(mx) });
  return out;
}

export const DEFAULT_RATE_CARD: Lane[] = buildCard();

// (cost, speed, reliability) weights; each row sums to 1.
export const WEIGHTS: Record<string, [Decimal, Decimal, Decimal]> = {
  Cheapest: [D("0.70"), D("0.15"), D("0.15")],
  Fastest: [D("0.10"), D("0.70"), D("0.20")],
  "Most reliable": [D("0.10"), D("0.15"), D("0.75")],
  Balanced: [D("0.40"), D("0.30"), D("0.30")],
};

// Cost-ratio cap: an option costing more than cap x the cheapest eligible option is dropped for that
// priority, so a small gain in speed/reliability can't justify a large premium. 'Fastest' is uncapped.
export const COST_CAP: Record<string, Decimal | null> = {
  Cheapest: D("1.5"), Balanced: D("1.5"), "Most reliable": D(3), Fastest: null,
};

export interface Option {
  lane: Lane;
  cost_gbp: Decimal;
  score: Decimal;
}

export interface CarrierOption {
  carrier: string;
  service: string;
  cost_gbp: number;
  transit_days: number;
  on_time_pct: number;
  max_pallet_kg: number;
  score: number;
}

export function optionToJSON(o: Option): CarrierOption {
  return {
    carrier: o.lane.name, service: o.lane.service, cost_gbp: Number(o.cost_gbp.toFixed(2)),
    transit_days: o.lane.transit_days, on_time_pct: o.lane.on_time_pct.toNumber(),
    max_pallet_kg: o.lane.max_pallet_kg.toNumber(), score: Number(o.score.toFixed(1)),
  };
}

export function perPalletKg(s: Shipment): Decimal | null {
  if (s.pallets && s.total_gross_weight_kg !== null) return D(s.total_gross_weight_kg).div(s.pallets);
  return null;
}

/** Every service that runs the booking's route, quoted, ignoring weight limits. */
export function laneOptions(s: Shipment, card: Lane[] = DEFAULT_RATE_CARD): Option[] {
  const out: Option[] = [];
  for (const lane of card) {
    if (lane.destination !== s.destination_country) continue;
    if (s.origin_country && lane.origin !== s.origin_country) continue;
    out.push({ lane, cost_gbp: lane.price_per_pallet.times(s.pallets || 1), score: D(0) });
  }
  return out;
}

export function fits(s: Shipment, opt: Option): boolean {
  const pp = perPalletKg(s);
  return pp === null || pp.lessThanOrEqualTo(opt.lane.max_pallet_kg);
}

/**
 * Returns [ranked best-first, dropped by the cost cap]. Scores are relative to the best in the set
 * (best/value for cost and days, value/best for on-time rate; 1.0 = best on that axis); ratio scaling
 * keeps one outlier from squashing the gaps between the others. Ties break on reliability, then cost.
 */
export function rankOptions(options: Option[], priority: string | null): [Option[], Option[]] {
  if (!options.length) return [[], []];
  const pr = priority && priority in WEIGHTS ? priority : "Balanced";
  const cap = COST_CAP[pr];
  const cheapest = options.reduce((m, o) => (o.cost_gbp.lessThan(m) ? o.cost_gbp : m), options[0].cost_gbp);
  const dropped = options.filter((o) => cap !== null && o.cost_gbp.greaterThan(cheapest.times(cap)));
  const kept = options.filter((o) => !dropped.includes(o)); // the cheapest option always survives
  const [wc, ws, wr] = WEIGHTS[pr];
  const bestCost = kept.reduce((m, o) => (o.cost_gbp.lessThan(m) ? o.cost_gbp : m), kept[0].cost_gbp);
  const bestDays = Math.min(...kept.map((o) => o.lane.transit_days));
  const bestRel = kept.reduce((m, o) => (o.lane.on_time_pct.greaterThan(m) ? o.lane.on_time_pct : m), kept[0].lane.on_time_pct);
  for (const o of kept) {
    o.score = D(100).times(
      wc.times(bestCost).div(o.cost_gbp)
        .plus(ws.times(D(bestDays)).div(D(o.lane.transit_days)))
        .plus(wr.times(o.lane.on_time_pct).div(bestRel)),
    );
  }
  kept.sort((a, b) => b.score.comparedTo(a.score) || b.lane.on_time_pct.comparedTo(a.lane.on_time_pct) || a.cost_gbp.comparedTo(b.cost_gbp));
  return [kept, dropped];
}

/** Rank only the services that can physically carry the load. */
export function rankDetailed(s: Shipment, priority: string | null, card: Lane[] = DEFAULT_RATE_CARD): [Option[], Option[]] {
  return rankOptions(laneOptions(s, card).filter((o) => fits(s, o)), priority);
}

/** The service the seller's priority points to, ignoring weight limits. R-05 is judged against this one. */
export function choose(s: Shipment, priority: string | null, card: Lane[] = DEFAULT_RATE_CARD): Option | null {
  const [ranked] = rankOptions(laneOptions(s, card), priority);
  return ranked[0] ?? null;
}

const days = (n: number, unit: string) => `${Math.abs(n)} ${unit}${Math.abs(n) === 1 ? "" : "s"}`;

/** Plain-language reason for the pick, with concrete trade-offs against the alternatives. */
export function justify(
  s: Shipment, ranked: Option[], priority: string | null, dropped: Option[] = [], allOptions: Option[] = [],
): string {
  const best = ranked[0];
  const pr = priority && priority in WEIGHTS ? priority : "Balanced";
  const lane = best.lane;
  const why = {
    Cheapest: "it has the lowest price", Fastest: "it has the shortest transit time",
    "Most reliable": "it has the highest on-time rate",
    Balanced: "it gives the best trade-off of cost, speed and reliability",
  }[pr];
  const parts = [
    `${laneLabel(lane)} is recommended for a '${pr}' priority because ${why}: £${money(best.cost_gbp)} for ` +
      `${s.pallets || 1} pallet(s), ${days(lane.transit_days, "day")} transit, ${g(lane.on_time_pct)}% on time.`,
  ];
  const cheapest = ranked.reduce((m, o) => (o.cost_gbp.lessThan(m.cost_gbp) ? o : m)); // dropped options are explained below
  const fastest = ranked.reduce((m, o) =>
    o.lane.transit_days < m.lane.transit_days || (o.lane.transit_days === m.lane.transit_days && o.cost_gbp.lessThan(m.cost_gbp)) ? o : m);
  if (best !== cheapest) {
    const extra = best.cost_gbp.minus(cheapest.cost_gbp);
    const dd = cheapest.lane.transit_days - lane.transit_days;
    const rel = lane.on_time_pct.minus(cheapest.lane.on_time_pct);
    const gains: string[] = [];
    if (dd > 0) gains.push(`${days(dd, "day")} faster`);
    if (rel.greaterThan(0)) gains.push(`${g(rel)} points more reliable`);
    parts.push(`It costs £${money(extra)} more than the cheapest option (${laneLabel(cheapest.lane)})` +
      (gains.length ? ` but is ${gains.join(" and ")}.` : "."));
  }
  if (best !== fastest) {
    parts.push(`${laneLabel(fastest.lane)} is quicker (${days(fastest.lane.transit_days, "day")}) but costs ` +
      `£${money(fastest.cost_gbp.minus(best.cost_gbp))} more.`);
  }
  for (const o of dropped) {
    parts.push(`${laneLabel(o.lane)} (${days(o.lane.transit_days, "day")}, £${money(o.cost_gbp)}) was not considered because it costs ` +
      `more than ${g(COST_CAP[pr]!)}x the cheapest option. Choose 'Fastest' to include premium services.`);
  }
  const pp = perPalletKg(s);
  for (const o of allOptions) {
    if (pp !== null && pp.greaterThan(o.lane.max_pallet_kg)) {
      parts.push(`${laneLabel(o.lane)} is excluded: ${fixed(pp, 0)} kg per pallet is over its ${g(o.lane.max_pallet_kg)} kg limit.`);
    }
  }
  return parts.join(" ");
}
