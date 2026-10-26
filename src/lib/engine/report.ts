// Pre-flight pipeline: validate -> match carrier -> structured report + plain-language summary.
import {
  DEFAULT_RATE_CARD, choose, justify, laneLabel, laneOptions, optionToJSON, perPalletKg, rankDetailed,
  type CarrierOption, type Lane, type Option,
} from "./carriers";
import type { Finding, Shipment } from "./models";
import { runRules, type Context } from "./rules";
import { D, addDays, fixed, fmtDMY, g, money, py, todayISO } from "./util";

export interface PreflightReport {
  booking_id: string | null;
  status: "BLOCKED" | "REVIEW" | "READY"; // BLOCKED (any Red) | REVIEW (Amber only) | READY
  red: Finding[];
  amber: Finding[];
  recommended_carrier: CarrierOption | null;
  alternatives: CarrierOption[];
  justification: string;
  provisional: boolean; // true when Red errors mean the carrier pick may change after fixes
  summary: string;
}

/** R-05 is judged against the carrier the seller's priority points to (rulebook: "the chosen carrier"). */
export function contextFor(s: Shipment, today: string, strict: boolean, card: Lane[] = DEFAULT_RATE_CARD): Context {
  const chosen = s.destination_country ? choose(s, s.priority, card) : null;
  return {
    today, strict,
    carrier_max_pallet_kg: chosen ? chosen.lane.max_pallet_kg : null,
    carrier_label: chosen ? laneLabel(chosen.lane) : "the chosen carrier",
  };
}

/** Turn the generic R-05 fix into concrete options using the real rate card. */
function refineR05(f: Finding, s: Shipment, chosen: Option | null, best: Option | null, card: Lane[]): void {
  const pp = perPalletKg(s)!;
  const limits = laneOptions(s, card).map((o) => o.lane.max_pallet_kg);
  const split = (lim: ReturnType<typeof D>) => D(s.total_gross_weight_kg!).div(lim).ceil().toString();
  if (best && chosen && best.lane !== chosen.lane) {
    f.fix = `Either split the load over at least ${split(chosen.lane.max_pallet_kg)} pallets so each is ` +
      `under ${g(chosen.lane.max_pallet_kg)} kg, or switch to ${laneLabel(best.lane)}, which accepts ` +
      `${g(best.lane.max_pallet_kg)} kg per pallet (£${money(best.cost_gbp)}, ${best.lane.transit_days} days).`;
  } else if (limits.length) {
    const mx = limits.reduce((m, x) => (x.greaterThan(m) ? x : m));
    f.fix = `No service on this route takes ${fixed(pp, 0)} kg per pallet (the maximum is ${g(mx)} kg). ` +
      `Split the load over at least ${split(mx)} pallets, or re-weigh if the figure is wrong.`;
  }
}

export function preflight(
  s: Shipment, today: string = todayISO(), strict = true, card: Lane[] = DEFAULT_RATE_CARD, interactive = true,
): PreflightReport {
  const ctx = contextFor(s, today, strict, card);
  const findings = runRules(s, ctx);
  const red = findings.filter((f) => f.severity === "Red");
  const amber = findings.filter((f) => f.severity === "Amber");

  const options = s.destination_country ? laneOptions(s, card) : [];
  const chosen = options.length ? choose(s, s.priority, card) : null;
  const [ranked, dropped] = options.length ? rankDetailed(s, s.priority, card) : [[], []];
  const best = ranked[0] ?? null;
  for (const f of red) if (f.rule_id === "R-05") refineR05(f, s, chosen, best, card);

  let why: string;
  if (best) why = justify(s, ranked, s.priority, dropped, options);
  else if (options.length) why = "No carrier on this route can take this load as declared, so no recommendation can be made yet.";
  else why = "No carrier serves this route.";

  const status = red.length ? "BLOCKED" : amber.length ? "REVIEW" : "READY";
  return {
    booking_id: s.booking_id, status, red, amber,
    recommended_carrier: best ? optionToJSON(best) : null,
    alternatives: ranked.slice(1).map(optionToJSON),
    justification: why, provisional: red.length > 0,
    summary: summarise(s, status, red, amber, best, interactive),
  };
}

export interface PlanCarrier { carrier: string; transit_days: number; cost_gbp: number }

export function collectionPlan(s: Shipment, best: PlanCarrier | null): string {
  if (!(best && s.ready_date)) return "";
  const eta = fmtDMY(addDays(s.ready_date, best.transit_days));
  return `${best.carrier} collects from ${s.origin_city || "the origin"} on ${fmtDMY(s.ready_date)} and delivers to ` +
    `${s.destination_city || py(s.destination_country)} in about ${best.transit_days} day(s) (around ${eta}), ` +
    `for £${money(best.cost_gbp)}.`;
}

function summarise(
  s: Shipment, status: string, red: Finding[], amber: Finding[], best: Option | null, interactive: boolean,
): string {
  let who = s.booking_id ? `Booking ${s.booking_id}` : "Shipment";
  if (s.seller_name) who += ` (${s.seller_name})`;
  const origin = [s.origin_city, s.origin_country].filter(Boolean).join(", ");
  const dest = [s.destination_city, s.destination_country].filter(Boolean).join(", ");
  const route = [origin, dest].filter(Boolean).join(" to ");
  const declared = s.total_declared_value_gbp === null ? "None" : `£${money(s.total_declared_value_gbp)}`;
  const lines = [
    `${who}: ${route || "route not set"} (${py(s.destination_type)}), ${py(s.pallets)} pallet(s), ` +
      `${py(s.total_gross_weight_kg)} kg, ${s.items.length} product line(s), declared ${declared}, ` +
      `ready ${fmtDMY(s.ready_date)}. Priority: ${py(s.priority)}.`,
  ];
  if (red.length) {
    lines.push(`${red.length} blocking issue(s) (Red) must be fixed before this can go:`);
    for (const f of red) lines.push(`  - [${f.rule_id}] ${f.title}: ${f.detail} Fix: ${f.fix}`);
  }
  if (amber.length) {
    lines.push("Warnings (Amber) to fix or check:");
    for (const f of amber) lines.push(`  - [${f.rule_id}] ${f.title}: ${f.detail} Fix: ${f.fix}`);
  }
  if (best) {
    lines.push(`${red.length ? "Provisional recommendation" : "Recommended carrier"}: ${laneLabel(best.lane)} - ` +
      `£${money(best.cost_gbp)}, ${best.lane.transit_days} day(s), ${g(best.lane.on_time_pct)}% on time.`);
  }
  lines.push("What happens next:");
  const go = collectionPlan(s, best ? { carrier: best.lane.name, transit_days: best.lane.transit_days, cost_gbp: best.cost_gbp.toNumber() } : null);
  if (status === "READY") {
    lines.push((interactive ? "  Everything checks out. Reply 'confirm' to book. " : "  Everything checks out. ") + go);
  } else if (status === "REVIEW") {
    lines.push((interactive ? "  You can confirm as-is, or correct the warnings first and I'll re-check. "
      : "  Safe to proceed, but fix or check the warnings first. ") + go);
  } else {
    lines.push(interactive ? "  Not booked. Send the corrections and the checks re-run instantly."
      : "  Not booked. Correct the Red items and re-submit this booking.");
    if (go) lines.push("  Once clear, the plan would be: " + go);
  }
  return lines.join("\n");
}
