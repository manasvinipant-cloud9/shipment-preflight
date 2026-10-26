// Conversational state machine.
//
// Division of labour: the LLM only *translates text into structured patch ops*. All state changes, validation,
// arithmetic and decisions happen here in deterministic code, so the model can never silently corrupt a
// shipment or skip a rule.
//
//   user text --extractor(LLM)--> ops --applyPatch--> Shipment --> missing slots / stale totals
//                                                         |--> live rules (strict=false)
//                                                         '--> preflight (strict=true) when complete
//
// The state is plain JSON (toState / fromState) because the API is stateless on Vercel: the browser holds it.
import { DESTINATIONS, DEST_TYPES, PRIORITIES, newItem, newShipment, type Finding, type Item, type Shipment } from "./models";
import { collectionPlan, contextFor, preflight, type PreflightReport } from "./report";
import { runRules } from "./rules";
import { D, Decimal, parseDate, isoFromDate, py } from "./util";

export type Phase = "collecting" | "confirming" | "booked";
export type Op = Record<string, unknown>;

export interface Snapshot {
  shipment: Record<string, string>;
  items: Record<string, string>[];
  stale: string[];
  phase: Phase;
  asking: string[];
}

export type Extractor = (text: string, snapshot: Snapshot, today: string) => Promise<Op[]>;

export class PatchError extends Error {}
/** Raised by an extractor when it cannot produce ops (API down, refusal, unparseable output). */
export class ExtractorError extends Error {}

// --- LLM contract -----------------------------------------------------------------------------
export const EXTRACTOR_SYSTEM_PROMPT = `You convert freight-booking chat messages into JSON patch ops. Output ONLY a JSON list.
Ops:
 {"op":"set","field":F,"value":V}          F in destination_country, destination_city, origin_city, seller_name,
                                           destination_type (Warehouse | Business address), delivery_appointment_booked,
                                           ready_date (YYYY-MM-DD; resolve 'tomorrow' / 'next Friday' using today's date given),
                                           pallets, total_cartons, total_gross_weight_kg, total_declared_value_gbp, priority
 {"op":"increment","field":"pallets","value":N}   for 'add a pallet' / 'one more pallet' (negative to remove)
 {"op":"upsert_item","sku":S,"fields":{description,hs_code,quantity,unit_price_gbp,units_per_carton,cartons,
                                       unit_weight_kg,country_of_origin}}   only fields the user stated; new item => new sku
 {"op":"remove_item","sku":S}
 {"op":"decline","field":F}               user doesn't know/refuses (only for optional fields)
 {"op":"keep","field":F}                  user confirms a flagged total is still correct
 {"op":"confirm"}                         user approves booking
Never invent values. Never convert currency: if not GBP, emit no op and say so via {"op":"note","text":...}.
Current state and today's date are provided in the user turn.`;

// --- Slots ------------------------------------------------------------------------------------
export const SHIPMENT_SLOTS: ReadonlyArray<readonly [keyof Shipment, string]> = [
  ["destination_country", "Which country is it going to - Germany, France or Netherlands?"],
  ["destination_type", "Is the destination a Warehouse or a Business address?"],
  ["ready_date", "When will the goods be ready for collection (date)?"],
  ["pallets", "How many pallets?"],
  ["total_gross_weight_kg", "What's the total gross weight in kg (including packaging and pallets)?"],
  ["total_cartons", "How many cartons in total?"],
  ["total_declared_value_gbp", "What's the total declared value in GBP?"],
  ["priority", "What matters most: Cheapest, Fastest, Most reliable, or Balanced?"],
];
export const ITEM_SLOTS: ReadonlyArray<readonly [keyof Item, string]> = [
  ["description", "a description"], ["quantity", "the quantity"], ["unit_price_gbp", "the unit price in GBP"],
  ["units_per_carton", "units per carton"], ["cartons", "the number of cartons"], ["unit_weight_kg", "the unit weight in kg"],
];
export const ITEM_FIELDS: ReadonlyArray<keyof Item> = [
  "description", "hs_code", "quantity", "unit_price_gbp", "units_per_carton", "cartons", "unit_weight_kg", "country_of_origin",
];
// Asked once; if declined stays null and the rule (R-08 / R-09 Amber, R-01 Red) reports it.
const OPTIONAL = new Set(["delivery_appointment_booked", "country_of_origin", "hs_code"]);

// When X changes, these shipment-level totals may no longer be true -> re-confirm with the user.
const STALE_ON: Record<string, string[]> = {
  pallets: ["total_gross_weight_kg"],
  "items+": ["total_cartons", "total_declared_value_gbp", "total_gross_weight_kg"],
  "items-": ["total_cartons", "total_declared_value_gbp", "total_gross_weight_kg"],
  quantity: ["total_declared_value_gbp", "total_gross_weight_kg"],
  unit_price_gbp: ["total_declared_value_gbp"],
  cartons: ["total_cartons"],
  unit_weight_kg: ["total_gross_weight_kg"],
};

const META_FIELDS = new Set(["booking_id", "seller_name", "origin_city", "origin_country", "destination_city"]);
const DEC_FIELDS = new Set(["total_gross_weight_kg", "total_declared_value_gbp", "unit_price_gbp", "unit_weight_kg"]);
const INT_FIELDS = new Set(["pallets", "total_cartons", "quantity", "units_per_carton", "cartons"]);

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/;

const title = (s: string) => s.toLowerCase().replace(/[a-z]+/g, (w) => w[0].toUpperCase() + w.slice(1));
const decimalText = (s: string) =>
  s.replace(/^([+-]?)\./, "$10.").replace(/^\+/, "").replace(/^(-?)0+(?=\d)/, "$1").replace(/\.$/, "");

/** Validate and normalise one raw value (typed text, LLM output or spreadsheet cell). */
export function coerce(name: string, v: unknown): unknown {
  if (v === null || v === undefined) throw new PatchError(`${name}: empty value`);
  const text = v instanceof Date ? "" : String(v);
  if (DEC_FIELDS.has(name)) {
    const s = text.replace(/,/g, "").replace(/£/g, "").trim();
    if (!NUMBER.test(s)) throw new PatchError(`${name}: couldn't read '${text}'`);
    if (D(s).isNegative() && !D(s).isZero()) throw new PatchError(`${name}: must not be negative`);
    return decimalText(s);
  }
  if (INT_FIELDS.has(name)) {
    const s = text.trim();
    if (!NUMBER.test(s)) throw new PatchError(`${name}: couldn't read '${text}'`);
    const i = D(s).trunc().toNumber();
    if (i <= 0) throw new PatchError(`${name}: must be at least 1`);
    return i;
  }
  if (name === "ready_date") {
    if (v instanceof Date) return isoFromDate(v);
    const iso = parseDate(text);
    if (iso) return iso;
    throw new PatchError(`ready_date: couldn't read '${text}' (use DD-MM-YYYY)`);
  }
  if (name === "hs_code") {
    if (typeof v === "number" && Number.isInteger(v)) return String(v); // Excel stores 691200 as 691200.0
    return text.trim().replace(/^(\d+)\.0$/, "$1");
  }
  if (name === "destination_country") {
    const c = title(text.trim());
    if (!(DESTINATIONS as readonly string[]).includes(c)) {
      throw new PatchError(`We only ship to Germany, France and the Netherlands (got '${text}').`);
    }
    return c;
  }
  if (name === "destination_type") {
    const t = ({ warehouse: "Warehouse", business: "Business address", "business address": "Business address" } as Record<string, string>)[text.trim().toLowerCase()];
    if (!t || !(DEST_TYPES as readonly string[]).includes(t)) throw new PatchError("destination type must be 'Warehouse' or 'Business address'");
    return t;
  }
  if (name === "priority") {
    const p = PRIORITIES.find((x) => x.toLowerCase() === text.trim().toLowerCase());
    if (!p) throw new PatchError(`priority must be one of [${[...PRIORITIES].sort().map((x) => `'${x}'`).join(", ")}]`);
    return p;
  }
  if (name === "delivery_appointment_booked") {
    const s = text.trim().toLowerCase();
    if (["yes", "y", "true", "booked"].includes(s)) return "Yes";
    if (["no", "n", "false", "not booked"].includes(s)) return "No";
    throw new PatchError("appointment must be Yes or No");
  }
  return text.trim();
}

export interface ConversationState {
  shipment: Shipment;
  phase: Phase;
  stale: string[];
  declined: string[];
  shown_warnings: string[];
  last_report: PreflightReport | null;
}

const get = (o: object, k: string) => (o as Record<string, unknown>)[k] ?? null;

export class Conversation {
  shipment: Shipment;
  phase: Phase;
  stale: Set<string>;
  declined: Set<string>;
  shown: Set<string>;
  lastReport: PreflightReport | null;

  constructor(public extractor: Extractor | null, public today: string, state?: ConversationState | null) {
    this.shipment = state?.shipment ?? newShipment();
    this.phase = state?.phase ?? "collecting";
    this.stale = new Set(state?.stale ?? []);
    this.declined = new Set(state?.declined ?? []);
    this.shown = new Set(state?.shown_warnings ?? []);
    this.lastReport = state?.last_report ?? null;
  }

  toState(): ConversationState {
    return {
      shipment: this.shipment, phase: this.phase, stale: [...this.stale], declined: [...this.declined],
      shown_warnings: [...this.shown], last_report: this.lastReport,
    };
  }

  // ---------------------------------------------------------------- patching
  /** Returns touched fields, user-facing errors and whether confirm was requested. Bad ops are skipped, not fatal. */
  applyPatch(ops: Op[]): { touched: Set<string>; errors: string[]; confirm: boolean } {
    const s = this.shipment as unknown as Record<string, unknown>;
    const touched = new Set<string>();
    const errors: string[] = [];
    let confirm = false;
    const allowed = new Set<string>([...SHIPMENT_SLOTS.map(([n]) => n as string), ...META_FIELDS, "delivery_appointment_booked"]);
    for (const op of ops) {
      try {
        const kind = op.op;
        if (kind === "set") {
          const f = op.field as string;
          if (typeof f !== "string" || op.value === undefined) throw new TypeError("bad set");
          if (!allowed.has(f)) throw new PatchError(`unknown field ${f}`);
          s[f] = coerce(f, op.value);
          touched.add(f);
        } else if (kind === "increment") {
          if (op.field !== "pallets") throw new PatchError("can only increment pallets");
          const n = Number(op.value);
          if (!Number.isInteger(n)) throw new TypeError("bad increment");
          const next = (this.shipment.pallets ?? 0) + n;
          if (next < 1) throw new PatchError("pallets can't drop below 1");
          this.shipment.pallets = next;
          STALE_ON.pallets.forEach((x) => this.stale.add(x)); // weight/pallet changes; ask, don't assume
        } else if (kind === "upsert_item") {
          if (typeof op.sku !== "string") throw new TypeError("bad sku");
          this.upsert(op.sku, (op.fields as Record<string, unknown>) ?? {});
        } else if (kind === "remove_item") {
          const before = this.shipment.items.length;
          this.shipment.items = this.shipment.items.filter((i) => i.sku !== op.sku);
          if (this.shipment.items.length === before) throw new PatchError(`no item ${String(op.sku)}`);
          STALE_ON["items-"].forEach((x) => this.stale.add(x));
        } else if (kind === "decline") {
          if (!OPTIONAL.has(String(op.field))) throw new PatchError(`${String(op.field)} is required`);
          this.declined.add(String(op.field));
        } else if (kind === "keep") {
          this.stale.delete(String(op.field));
        } else if (kind === "confirm") {
          confirm = true;
        }
        // "note" ops are informational for the reply layer and ignored here
      } catch (e) {
        if (e instanceof PatchError) errors.push(e.message);
        else if (e instanceof TypeError) errors.push(`couldn't apply ${JSON.stringify(op)}`);
        else throw e;
      }
    }
    touched.forEach((f) => this.stale.delete(f)); // explicitly (re)stated this turn => no longer stale
    return { touched, errors, confirm };
  }

  private upsert(sku: string, fields: Record<string, unknown>): void {
    let item = this.shipment.items.find((i) => i.sku === sku);
    if (!item) {
      item = newItem(sku);
      this.shipment.items.push(item);
      STALE_ON["items+"].forEach((x) => this.stale.add(x));
    }
    for (const [k, v] of Object.entries(fields)) {
      if (!(ITEM_FIELDS as readonly string[]).includes(k)) throw new PatchError(`unknown item field ${k}`);
      (item as unknown as Record<string, unknown>)[k] = coerce(k, v);
      (STALE_ON[k] ?? []).forEach((x) => this.stale.add(x));
    }
  }

  // ---------------------------------------------------------------- slot logic
  /** Questions for required slots still empty, in a stable order. */
  missing(): string[] {
    const s = this.shipment;
    const qs: string[] = SHIPMENT_SLOTS.filter(([f]) => get(s, f) === null).map(([, q]) => q);
    if (!s.items.length) {
      qs.push("What are you shipping? Give me each product line: description, HS code, quantity, " +
        "unit price (GBP), units per carton, cartons, unit weight (kg).");
    }
    for (const it of s.items) {
      const gaps = ITEM_SLOTS.filter(([f]) => get(it, f) === null).map(([, label]) => label);
      if (gaps.length) qs.push(`For '${it.description || it.sku}', I still need: ${gaps.join(", ")}.`);
    }
    if (s.destination_type === "Warehouse" && s.delivery_appointment_booked === null && !this.declined.has("delivery_appointment_booked")) {
      qs.push("Is a delivery appointment booked with the warehouse (Yes/No)?");
    }
    for (const it of s.items) {
      if (it.hs_code === null && !this.declined.has("hs_code")) {
        qs.push(`What's the HS (customs) code for '${it.description || it.sku}'? ` +
          "(6+ digits; say 'unknown' to skip - it will be flagged as a blocking issue)");
      }
    }
    for (const it of s.items) {
      if (it.country_of_origin === null && !this.declined.has(`origin:${it.sku}`) && !this.declined.has("country_of_origin")) {
        qs.push(`What's the country of origin for '${it.description || it.sku}'? (say 'unknown' to skip)`);
      }
    }
    return qs;
  }

  staleQuestions(): string[] {
    const s = this.shipment;
    const label: Record<string, string> = {
      total_gross_weight_kg: `total gross weight (${py(s.total_gross_weight_kg)} kg)`,
      total_cartons: `total cartons (${py(s.total_cartons)})`,
      total_declared_value_gbp: `total declared value (£${py(s.total_declared_value_gbp)})`,
    };
    return [...this.stale].sort()
      .filter((f) => f in label && get(s, f) !== null)
      .map((f) => `Since that changed, is the ${label[f]} still right? Give the new figure or say it's unchanged.`);
  }

  // ---------------------------------------------------------------- turn loop
  async turn(userText: string): Promise<string> {
    if (!this.extractor) throw new ExtractorError("no extractor configured");
    let ops: Op[];
    try {
      ops = await this.extractor(userText, this.snapshot(), this.today);
    } catch (e) {
      if (e instanceof ExtractorError) {
        return `Sorry, I couldn't read that just now (${e.message}). Nothing was changed - please try again or rephrase.`;
      }
      throw e;
    }
    return this.handleOps(ops);
  }

  /** Apply already-extracted ops and produce the reply. Also the entry point for non-chat input. */
  handleOps(ops: Op[]): string {
    const { touched, errors, confirm } = this.applyPatch(ops);
    const dataChanged = touched.size > 0 || ops.some((o) => !["confirm", "note", "keep"].includes(String(o.op)));
    const reply: string[] = errors.map((e) => `(Couldn't use: ${e})`);

    if (this.phase === "booked") return "This shipment is already booked. Start a new booking for anything else.";
    if (this.phase === "confirming" && dataChanged) this.phase = "collecting"; // any edit invalidates the shown pre-flight

    reply.push(...this.headsUp());
    const gaps = this.missing();
    const stale = this.staleQuestions();
    if (gaps.length || stale.length) {
      this.phase = "collecting";
      reply.push([...stale, ...gaps].slice(0, 3).join("\n")); // never interrogate: max 3 questions per turn
      return reply.join("\n");
    }

    if (this.phase === "confirming" && confirm && this.lastReport && this.lastReport.status !== "BLOCKED") {
      this.phase = "booked";
      const rec = this.lastReport.recommended_carrier!;
      return `Booked with ${rec.carrier} (${rec.service}). ` + collectionPlan(this.shipment, rec);
    }

    this.lastReport = preflight(this.shipment, this.today, true);
    this.phase = "confirming";
    reply.push(this.lastReport.summary);
    return reply.join("\n");
  }

  /** Surface rule hits as soon as their inputs exist (e.g. banned goods), once each. */
  private headsUp(): string[] {
    const out: string[] = [];
    for (const f of this.liveFindings()) {
      const key = [f.rule_id, f.field, f.detail].join("\u0001");
      if (!this.shown.has(key) && this.missing().length) { // final summary will list the rest
        this.shown.add(key);
        out.push(`Heads-up [${f.severity}] ${f.title}: ${f.detail}`);
      }
    }
    return out;
  }

  /** Rule hits on what has been collected so far (draft mode: missing inputs are skipped, not flagged). */
  liveFindings(): Finding[] {
    return runRules(this.shipment, contextFor(this.shipment, this.today, false));
  }

  snapshot(): Snapshot {
    const s = this.shipment;
    const str = (o: object) => Object.fromEntries(Object.entries(o).filter(([k, v]) => k !== "items" && v !== null).map(([k, v]) => [k, String(v)]));
    return {
      shipment: str(s), items: s.items.map(str), stale: [...this.stale].sort(), phase: this.phase,
      asking: this.staleQuestions().slice(0, 3).length ? this.staleQuestions().slice(0, 3) : this.missing().slice(0, 3),
    };
  }
}

export { Decimal };
