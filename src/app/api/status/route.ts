import { NextResponse } from "next/server";
import { getExtractor, hasGeminiKey, probeExtraction, probeModels } from "@/lib/engine/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Whether plain-English chat is available (a Gemini key is configured). Never exposes the key. */
export async function GET(req: Request) {
  const { llm, label } = getExtractor();
  // /api/status?probe=1 tests each configured model with a tiny call (which work, how fast). Never returns the key.
  const q = new URL(req.url).searchParams;
  const probe = q.get("probe");
  if (probe === "1" && hasGeminiKey()) return NextResponse.json({ llm, label, models: await probeModels() });
  // ?probe=extract runs the real extraction prompt per model: latency and which fields each model extracts.
  if (probe === "extract" && hasGeminiKey()) return NextResponse.json({ llm, label, extraction: await probeExtraction(q.get("level") ?? "default") });
  return NextResponse.json({ llm, label });
}
