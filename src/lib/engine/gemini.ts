// Gemini-backed extractor, following the same pattern as the other projects: GEMINI_API_KEY, GEMINI_MODEL and an
// ordered GEMINI_FALLBACK_MODELS list tried when the primary is out of quota (429), overloaded (503) or retired (404).
// Server-only: this file must never be imported by client components (it reads the API key).
import { GoogleGenAI } from "@google/genai";
import { ExtractorError, type Extractor, type Op, type Snapshot } from "./conversation";
import { OPS_SCHEMA, SYSTEM_PROMPT, parseModelJson, ruleBasedExtract, sanitizeOps } from "./extractor";

const DEFAULT_MODEL = "gemini-3.7-flash";
const DEFAULT_FALLBACKS = "gemini-3.6-flash,gemini-3.5-flash,gemini-3-flash-preview,gemini-3.5-flash-lite,gemini-3.1-flash-lite";

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

type Generate = (model: string, contents: string, withSchema: boolean) => Promise<string | undefined>;

const realGenerate: Generate = async (model, contents, withSchema) => {
  const res = await ai().models.generateContent({
    model,
    contents,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: "application/json",
      ...(withSchema ? { responseJsonSchema: OPS_SCHEMA } : {}),
      temperature: 0,
      abortSignal: AbortSignal.timeout(10_000),
    },
  });
  return res.text;
};

/** Exposed for tests: the same logic with an injectable generate function. */
export function makeGeminiExtractor(generate: Generate = realGenerate, models: () => string[] = modelChain): Extractor {
  return async (text: string, snapshot: Snapshot, today: string): Promise<Op[]> => {
    const payload = JSON.stringify({ today, state: snapshot, seller_message: text }, null, 1);
    let lastError = "no model available";
    for (const model of models()) {
      if ((cooldown.get(model) ?? 0) > Date.now()) continue;
      for (const withSchema of [true, false]) {
        try {
          const raw = await generate(model, payload, withSchema);
          if (!raw) throw new ExtractorError("Gemini returned no text");
          return sanitizeOps(parseModelJson(raw));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(`[gemini] ${model}${withSchema ? "" : " (no schema)"} failed: ${redact(msg).slice(0, 200)}`);
          if (e instanceof ExtractorError) { lastError = msg; break; } // empty/invalid output: next model
          // A rejected key fails every model the same way: stop at once with a message the user can act on.
          if (AUTH_ERROR.test(msg)) throw new ExtractorError("Gemini rejected the API key (check GEMINI_API_KEY in Vercel)");
          lastError = msg.slice(0, 160);
          // Schema dialect rejected (400): retry the same model in plain JSON mode before moving on.
          if (withSchema && (msg.includes('"code":400') || msg.includes("INVALID_ARGUMENT"))) continue;
          cooldown.set(model, Date.now() + coolFor(msg));
          break;
        }
      }
    }
    throw new ExtractorError(`Gemini API error: ${lastError}`);
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
    return { extractor: makeGeminiExtractor(), label: `Gemini (${modelChain()[0]})`, llm: true };
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
