// Extractors: output sanitising, the offline parser, and the Gemini extractor (with a fake model: these prove our
// request shape, parsing, model fallback and error handling, NOT the model's extraction quality, which needs a live key).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Conversation, ExtractorError, type Snapshot } from "../engine/conversation";
import { OPS_SCHEMA, ruleBasedExtract, sanitizeOps } from "../engine/extractor";
import { getExtractor, makeGeminiExtractor, modelChain } from "../engine/gemini";

const TODAY = "2026-10-25";
const demo = readFileSync(join(process.cwd(), "public/samples/demo_chat.txt"), "utf8");
const snap = (over: Partial<Snapshot> = {}): Snapshot => ({ shipment: {}, items: [], stale: [], phase: "collecting", asking: [], ...over });

describe("sanitizeOps", () => {
  it("drops garbage and injection attempts", () => {
    const raw = {
      ops: [
        { op: "set", field: "pallets", value: "2" }, { op: "drop_database" }, { op: "set" }, { op: "set", field: "pallets", value: null },
        "string", { op: "upsert_item", fields: {} },
        { op: "upsert_item", sku: "A", fields: { hs_code: "610910", evil: "x", cartons: null } },
      ],
    };
    expect(sanitizeOps(raw)).toEqual([
      { op: "set", field: "pallets", value: "2" },
      { op: "upsert_item", sku: "A", fields: { hs_code: "610910" } },
    ]);
    // a model rambling inside a value is dropped, not stored
    const rant = "x".repeat(300);
    expect(sanitizeOps([{ op: "set", field: "seller_name", value: rant }, { op: "upsert_item", sku: "A", fields: { description: "ok", country_of_origin: rant } }]))
      .toEqual([{ op: "upsert_item", sku: "A", fields: { description: "ok" } }]);
    expect(sanitizeOps("nope")).toEqual([]);
    expect(sanitizeOps(null)).toEqual([]);
  });

  it("is still validated by the state machine", async () => {
    const bad = { ops: [{ op: "set", field: "destination_country", value: "Spain" }, { op: "set", field: "pallets", value: "-2" }] };
    const conv = new Conversation(async () => sanitizeOps(bad), TODAY);
    const r = await conv.turn("ship to Spain");
    expect(conv.shipment.destination_country).toBeNull();
    expect(conv.shipment.pallets).toBeNull();
    expect(r).toContain("Couldn't use");
  });
});

describe("offline parser", () => {
  it("runs the whole demo flow with edits", async () => {
    const conv = new Conversation(ruleBasedExtract, TODAY);
    await conv.turn(demo);
    expect(conv.phase).toBe("confirming");
    expect(conv.lastReport!.status).toBe("REVIEW");
    expect(await conv.turn("add a pallet")).toContain("still right");
    expect(conv.shipment.pallets).toBe(3);
    await conv.turn("unchanged");
    expect(conv.phase).toBe("confirming");
    await conv.turn("appointment: yes");
    expect(conv.lastReport!.status).toBe("READY");
    await conv.turn("confirm");
    expect(conv.phase).toBe("booked");
  });

  it("answers follow the question that was asked", async () => {
    const conv = new Conversation(ruleBasedExtract, TODAY);
    await conv.turn("country: France");
    await conv.turn("Business");
    await conv.turn("2026-11-02");
    expect([conv.shipment.destination_country, conv.shipment.destination_type]).toEqual(["France", "Business address"]);
    expect(conv.shipment.ready_date).toBe("2026-11-02");
    await conv.turn("4"); // answers "How many pallets?"
    expect(conv.shipment.pallets).toBe(4);
  });

  it("handles JSON paste and commas inside descriptions", async () => {
    const ops = await ruleBasedExtract("item X: desc=Mugs, ceramic, large, hs=691200, qty=10", snap(), TODAY);
    expect((ops[0].fields as Record<string, string>).description).toBe("Mugs, ceramic, large");
    expect((ops[0].fields as Record<string, string>).hs_code).toBe("691200");
    const paste = JSON.stringify({
      destination_country: "Germany", destination_type: "Warehouse", delivery_appointment_booked: "Yes", ready_date: "01-12-2026",
      pallets: 2, total_cartons: 30, total_gross_weight_kg: 520, total_declared_value_gbp: 6000, priority: "Balanced",
      items: [
        { sku: "A", description: "Cotton t-shirts", hs_code: "610910", quantity: 1000, unit_price_gbp: 3, units_per_carton: 50, cartons: 20, unit_weight_kg: 0.2, country_of_origin: "India" },
        { sku: "B", description: "Mugs", hs_code: "691200", quantity: 500, unit_price_gbp: 6, units_per_carton: 50, cartons: 10, unit_weight_kg: 0.4, country_of_origin: "China" },
      ],
    });
    const conv = new Conversation(ruleBasedExtract, "2026-10-25");
    await conv.turn(paste);
    expect(conv.lastReport!.status).toBe("READY");
  });

  it("'unknown' declines only what was asked", async () => {
    expect(await ruleBasedExtract("unknown", snap({ asking: ["What's the HS (customs) code for 'mugs'?"] }), TODAY)).toEqual([{ op: "decline", field: "hs_code" }]);
    expect(await ruleBasedExtract("skip", snap({ asking: ["What's the country of origin for 'mugs'?"] }), TODAY)).toEqual([{ op: "decline", field: "country_of_origin" }]);
  });
});

// ----------------------------------------------------------------------------- Gemini
const ok = (ops: unknown[]) => JSON.stringify({ ops });
const chain = (...m: string[]) => () => m;

describe("gemini extractor", () => {
  it("sends today, state and the message, with the schema", async () => {
    const calls: Array<[string, string, { schema: boolean; thinking: boolean }]> = [];
    const ex = makeGeminiExtractor(async (m, c, s) => { calls.push([m, c, s]); return ok([{ op: "set", field: "pallets", value: "3" }]); }, chain("t-happy"));
    expect(await ex("3 pallets", snap({ phase: "collecting" }), TODAY)).toEqual([{ op: "set", field: "pallets", value: "3" }]);
    const body = JSON.parse(calls[0][1]);
    expect(body.today).toBe(TODAY);
    expect(body.seller_message).toBe("3 pallets");
    expect(calls[0][2]).toEqual({ schema: true, thinking: true });
    expect(OPS_SCHEMA.required).toEqual(["ops"]);
  });

  it("tolerates code fences, prose and a bare list", async () => {
    for (const raw of ['```json\n{"ops":[{"op":"confirm"}]}\n```', 'Sure! {"ops":[{"op":"confirm"}]} done', '[{"op":"confirm"}]']) {
      const ex = makeGeminiExtractor(async () => raw, chain(`t-fence-${raw.length}`));
      expect(await ex("x", snap(), TODAY)).toEqual([{ op: "confirm" }]);
    }
  });

  it("steps down to simpler requests when an option is rejected (400)", async () => {
    const seen: string[] = [];
    const ex = makeGeminiExtractor(async (_m, _c, v) => {
      seen.push(`${v.schema ? "schema" : "plain"}/${v.thinking ? "think" : "nothink"}`);
      if (v.thinking || v.schema) throw new Error('{"error":{"code":400,"status":"INVALID_ARGUMENT"}}');
      return ok([]);
    }, chain("t-schema"));
    expect(await ex("x", snap(), TODAY)).toEqual([]);
    expect(seen).toEqual(["schema/think", "schema/nothink", "plain/nothink"]);
  });

  it("falls through the model chain on quota errors, and remembers the failed model", async () => {
    const used: string[] = [];
    const gen = async (m: string) => {
      used.push(m);
      if (m === "t-primary") throw new Error('{"error":{"code":429,"message":"quota"}}');
      return ok([{ op: "confirm" }]);
    };
    const ex = makeGeminiExtractor(gen, chain("t-primary", "t-second"));
    expect(await ex("x", snap(), TODAY)).toEqual([{ op: "confirm" }]);
    expect(await ex("y", snap(), TODAY)).toEqual([{ op: "confirm" }]);
    expect(used).toEqual(["t-primary", "t-second", "t-second"]); // primary is cooled down for the second call
  });

  it("stops at once when the API key is rejected, without trying other models", async () => {
    const used: string[] = [];
    const ex = makeGeminiExtractor(async (m) => { used.push(m); throw new Error('{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}'); }, chain("t-auth-1", "t-auth-2"));
    await expect(ex("x", snap(), TODAY)).rejects.toThrow(/rejected the API key/);
    expect(used).toEqual(["t-auth-1"]);
  });

  it("turns every failure into an ExtractorError, and the conversation stays unchanged", async () => {
    for (const [i, gen] of [
      async () => { throw new Error("500"); },
      async () => "no json here",
      async () => undefined,
    ].entries()) {
      const ex = makeGeminiExtractor(gen, chain(`t-fail-${i}`));
      await expect(ex("x", snap(), TODAY)).rejects.toBeInstanceOf(ExtractorError);
    }
    const conv = new Conversation(makeGeminiExtractor(async () => { throw new Error("down"); }, chain("t-fail-conv")), TODAY);
    expect(await conv.turn("hi")).toContain("Nothing was changed");
    expect(conv.shipment.pallets).toBeNull();
  });
});

describe("configuration", () => {
  const KEYS = ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GEMINI_MODEL", "GEMINI_FALLBACK_MODELS", "PREFLIGHT_MODEL"];
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  afterEach(() => { for (const k of KEYS) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]); });
  const clear = () => KEYS.forEach((k) => delete process.env[k]);

  it("uses Gemini only when a key is configured", () => {
    clear();
    expect(getExtractor().llm).toBe(false);
    expect(getExtractor().label).toContain("no API key");
    process.env.GEMINI_API_KEY = "k";
    expect(getExtractor().llm).toBe(true);
    expect(getExtractor().label).toContain("gemini-3-flash-preview");
    expect(getExtractor({ offline: true }).llm).toBe(false);
  });

  it("accepts GOOGLE_API_KEY too", () => {
    clear();
    process.env.GOOGLE_API_KEY = "k";
    expect(getExtractor().llm).toBe(true);
  });

  it("model precedence: GEMINI_MODEL, then a gemini PREFLIGHT_MODEL, then the default; fallbacks follow", () => {
    clear();
    expect(modelChain()[0]).toBe("gemini-3-flash-preview");
    process.env.PREFLIGHT_MODEL = "claude-opus-5-5"; // a non-Gemini id must not leak into Gemini calls
    expect(modelChain()[0]).toBe("gemini-3-flash-preview");
    process.env.PREFLIGHT_MODEL = "gemini-x-pro";
    expect(modelChain()[0]).toBe("gemini-x-pro");
    process.env.GEMINI_MODEL = "gemini-y";
    process.env.GEMINI_FALLBACK_MODELS = "gemini-y, gemini-z,";
    expect(modelChain()).toEqual(["gemini-y", "gemini-z"]);
  });
});
