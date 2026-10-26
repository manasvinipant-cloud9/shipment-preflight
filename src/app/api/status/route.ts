import { NextResponse } from "next/server";
import { getExtractor, hasGeminiKey, probeModels } from "@/lib/engine/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Whether plain-English chat is available (a Gemini key is configured). Never exposes the key. */
export async function GET(req: Request) {
  const { llm, label } = getExtractor();
  // /api/status?probe=1 tests each configured model with a tiny call (which work, how fast). Never returns the key.
  if (new URL(req.url).searchParams.get("probe") === "1" && hasGeminiKey()) {
    return NextResponse.json({ llm, label, models: await probeModels() });
  }
  return NextResponse.json({ llm, label });
}
