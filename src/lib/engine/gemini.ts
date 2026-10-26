// Gemini-backed extractor, following the same pattern as the other projects: GEMINI_API_KEY, GEMINI_MODEL and an
// ordered GEMINI_FALLBACK_MODELS list tried when the primary is out of quota (429), overloaded (503) or retired (404).
// Server-only: this file must never be imported by client components (it reads the API key).
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { ExtractorError, type Extractor, type Op, type Snapshot } from "./conversation";
import { OPS_SCHEMA, SYSTEM_PROMPT, parseModelJson, repairItemOps, ruleBasedExtract, sanitizeOps } from "./extractor";

// Measured on the real extraction prompt (see /api/status?probe=extract): gemini-3-flash-preview captured every field in
// every run in ~1.7 s; gemini-3.7-flash was returning 503 "high demand". Override with GEMINI_MODEL.
const DEFAULT_MODEL = "gemini-3-flash-preview";
const DEFAULT_FALLBACKS = "gemini-3.5-flash,gemini-3.6-flash,gemini-3.7-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite";

export const hasGeminiKey = () => Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);

/** Primary model first, then the fallbacks; duplicates and blanks removed. */
export function modelChain(): string[] {
  const shared = process.env.PREFLIGHT_MODEL ?? "";
  const primary = process.env.GEMINI_MODEL || (shared.startsWith("gemini") ? shared : DEFAULT_MODEL);
  const fallbacks = (process.env.GEMINI_FALLBACK_MODELS ?? DEFAULT_FALLBACKS).split(",");
  return [...new Set([primary, ...fallbacks].map((m) => m.trim()).filter(Boolean))];
}

let client: GoogleGenAI | null = null;
const ai = () => (client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY }));

// A model that just failed is skipped for a while: 429 = quota, 503 = high demand (5 min), 404 = retired (1 h), others = 45 s.
const cooldown = new Map<string, number>();
const coolFor = (msg: string) =>
  msg.includes('"code":429') || msg.includes('"code":503') ? 5 * 60_000 : msg.includes('"code":404') ? 3600_000 : 45_000;

const redact = (s: string) => s.replace(/AIza[0-9A-Za-z_-]{10,}/g, "[key]");

const AUTH_ERROR = /API key not valid|API_KEY_INVALID|"code":\s*40[13]|PERMISSION_DENIED|UNAUTHENTICATED/i;

export interface Variant { schema: boolean; thinking: boolean }
type Generate = (model: string, contents: string, v: Variant, level?: string) => Promise<string | undefined>;

// Extraction is a text-to-fields job: Gemini 3 models "think" for many seconds by default, which made real calls time out.
// GEMINI_THINKING_LEVEL = minimal | low (default) | medium | high | off (send no thinking setting).
const THINKING: Record<string, ThinkingLevel> = {
  minimal: ThinkingLevel.MINIMAL, low: ThinkingLevel.LOW, medium: ThinkingLevel.MEDIUM, high: ThinkingLevel.HIGH,
};
const thinkingConfig = (override?: string) => {
  const level = (override ?? process.env.GEMINI_THINKING_LEVEL ?? "low").toLowerCase();
  return level in THINKING ? { thinkingConfig: { thinkingLevel: THINKING[level] } } : {};
};

const MODEL_TIMEOUT_MS = 12_000;
const BUDGET_MS = 28_000; // whole request; the function limit is 60 s

const realGenerate: Generate = async (model, contents, v, level) => {
  const res = await ai().models.generateContent({
    model,
    contents,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: "application/json",
      ...(v.schema ? { responseJsonSchema: OPS_SCHEMA } : {}),
      ...(v.thinking ? thinkingConfig(level) : {}),
      temperature: 0,
      abortSignal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    },
  });
  return res.text;
};

// Tried in order for each model; a 400 (an option this model rejects) steps down to the next, simpler variant.
const VARIANTS: Variant[] = [
  { schema: true, thinking: true }, { schema: true, thinking: false }, { schema: false, thinking: false },
];

/** Exposed for tests: the same logic with an injectable generate function. */
export function makeGeminiExtractor(generate: Generate = realGenerate, models: () => string[] = modelChain): Extractor {
  return async (text: string, snapshot: Snapshot, today: string): Promise<Op[]> => {
    const payload = JSON.stringify({ today, state: snapshot, seller_message: text }, null, 1);
    let lastError = "no model available";
    const started = Date.now();
    for (const model of models()) {
      if ((cooldown.get(model) ?? 0) > Date.now()) continue;
      if (Date.now() - started > BUDGET_MS) { lastError = "timed out"; break; }
      for (const v of VARIANTS) {
        try {
          const raw = await generate(model, payload, v);
          if (!raw) throw new ExtractorError("Gemini returned no text");
          return repairItemOps(sanitizeOps(parseModelJson(raw)));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(`[gemini] ${model} (schema=${v.schema}, thinking=${v.thinking}) failed: ${redact(msg).slice(0, 200)}`);
          if (e instanceof ExtractorError) { lastError = msg; break; } // empty/invalid output: next model
          // A rejected key fails every model the same way: stop at once with a message the user can act on.
          if (AUTH_ERROR.test(msg)) throw new ExtractorError("Gemini rejected the API key (check GEMINI_API_KEY in Vercel)");
          lastError = redact(msg).slice(0, 160);
          // An option this model doesn't accept (400): retry the same model with a simpler request before moving on.
          if (msg.includes('"code":400') || msg.includes("INVALID_ARGUMENT")) continue;
          cooldown.set(model, Date.now() + coolFor(msg));
          break;
        }
      }
    }
    throw new ExtractorError(`Gemini API error: ${lastError}`);
  };
}

/**
 * Short control messages ("confirm", "add a pallet", "unchanged", "4", "unknown") are answered by the deterministic parser:
 * instant, free, and they keep working even when the model is busy. Anything longer or unrecognised goes to Gemini.
 */
export function withQuickCommands(llm: Extractor): Extractor {
  return async (text, snapshot, today) => {
    if (text.length <= 30 && !text.includes("\n")) {
      const quick = await ruleBasedExtract(text, snapshot, today);
      if (quick.length) return quick;
    }
    return llm(text, snapshot, today);
  };
}

export interface ExtractorChoice {
  extractor: Extractor;
  label: string;
  llm: boolean;
}

/** Gemini when a key is configured (and offline wasn't forced), otherwise the keyless offline parser. */
export function getExtractor(opts: { offline?: boolean } = {}): ExtractorChoice {
  if (!opts.offline && hasGeminiKey()) {
    return { extractor: withQuickCommands(makeGeminiExtractor()), label: `Gemini (${modelChain()[0]})`, llm: true };
  }
  return { extractor: ruleBasedExtract, label: opts.offline ? "Offline parser (switched on)" : "Offline parser (no API key)", llm: false };
}

export interface ProbeResult { model: string; ok: boolean; ms: number; error?: string }

let probeCache: { at: number; results: ProbeResult[] } | null = null;

/** Tiny test call to every model in the chain, so "which of my models actually work, and how fast?" has an answer. */
export async function probeModels(): Promise<ProbeResult[]> {
  if (probeCache && Date.now() - probeCache.at < 60_000) return probeCache.results; // cheap + hard to abuse
  const results = await Promise.all(modelChain().map(async (model): Promise<ProbeResult> => {
    const t0 = Date.now();
    try {
      await ai().models.generateContent({
        model, contents: "Reply with the single word OK.",
        config: { temperature: 0, maxOutputTokens: 16, abortSignal: AbortSignal.timeout(15_000) },
      });
      return { model, ok: true, ms: Date.now() - t0 };
    } catch (e) {
      return { model, ok: false, ms: Date.now() - t0, error: redact(e instanceof Error ? e.message : String(e)).slice(0, 200) };
    }
  }));
  probeCache = { at: Date.now(), results };
  return results;
}

export interface ExtractProbe { model: string; ok: boolean; ms: number; ops?: number; fields?: string[]; items?: string[]; raw?: string; error?: string }

let extractCache: { at: number; level: string; results: ExtractProbe[] } | null = null;
const PROBE_MESSAGE = "I need to send 2 pallets of ceramic mugs from Manchester to a warehouse in Frankfurt, ready on 9 November 2026. " +
  "620 kg in total and 90 cartons. It's 1080 mugs (90 cartons of 12) at £5 each, 0.5 kg each, HS code 691200, made in the UK. " +
  "Declared value £5,400, appointment already booked. Balanced please.";

/** Runs the REAL extraction prompt on a fixed message with every model (no cooldowns), so latency and quality are measurable. */
export async function probeExtraction(level = "default"): Promise<ExtractProbe[]> {
  if (extractCache && extractCache.level === level && Date.now() - extractCache.at < 20_000) return extractCache.results;
  const payload = JSON.stringify({ today: "2026-10-26", state: { shipment: {}, items: [], stale: [], phase: "collecting", asking: [] }, seller_message: PROBE_MESSAGE }, null, 1);
  const results = await Promise.all(modelChain().map(async (model): Promise<ExtractProbe> => {
    const t0 = Date.now();
    try {
      const raw = await realGenerate(model, payload, VARIANTS[0], level === "default" ? undefined : level);
      const ops = repairItemOps(sanitizeOps(parseModelJson(raw ?? "")));
      const fields = ops.flatMap((o) => (o.op === "set" ? [String(o.field)] : o.op === "upsert_item" ? Object.keys((o.fields as object) ?? {}).map((k) => `item.${k}`) : []));
      return { model, ok: true, ms: Date.now() - t0, ops: ops.length, fields, items: ops.filter((o) => o.op === "upsert_item").map((o) => String(o.sku)), raw: (raw ?? "").replace(/\s+/g, " ").slice(0, 1200) };
    } catch (e) {
      return { model, ok: false, ms: Date.now() - t0, error: redact(e instanceof Error ? e.message : String(e)).slice(0, 160) };
    }
  }));
  extractCache = { at: Date.now(), level, results };
  return results;
}
