import { NextResponse } from "next/server";
import { Conversation, type ConversationState } from "@/lib/engine/conversation";
import { getExtractor } from "@/lib/engine/gemini";
import { todayISO } from "@/lib/engine/util";
import { buildView } from "@/lib/engine/view";

export const runtime = "nodejs";
export const maxDuration = 60;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** The server keeps no state: the browser sends the conversation state back with each message. */
export async function POST(req: Request) {
  let body: { message?: unknown; state?: unknown; today?: unknown; offline?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const message = typeof body.message === "string" ? body.message : "";
  if (!message.trim()) return NextResponse.json({ error: "Type a message first." }, { status: 400 });
  if (message.length > 20_000) return NextResponse.json({ error: "That message is too long." }, { status: 400 });
  const today = typeof body.today === "string" && ISO.test(body.today) ? body.today : todayISO();

  const choice = getExtractor({ offline: body.offline === true });
  try {
    const conv = new Conversation(choice.extractor, today, (body.state as ConversationState | null) ?? null);
    const reply = await conv.turn(message);
    return NextResponse.json({
      reply, state: conv.toState(), view: buildView(conv), mode: { llm: choice.llm, label: choice.label },
    });
  } catch {
    // A tampered or stale state from the browser, never a stack trace.
    return NextResponse.json({ error: "Couldn't process that. Start a new booking and try again." }, { status: 400 });
  }
}
