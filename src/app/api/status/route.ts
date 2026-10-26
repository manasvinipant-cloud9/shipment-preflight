import { NextResponse } from "next/server";
import { getExtractor } from "@/lib/engine/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Whether plain-English chat is available (a Gemini key is configured). Never exposes the key. */
export async function GET() {
  const { llm, label } = getExtractor();
  return NextResponse.json({ llm, label });
}
