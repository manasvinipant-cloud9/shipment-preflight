import { NextResponse } from "next/server";
import { proposeFix } from "@/lib/engine/autofix";
import { Conversation, type ConversationState } from "@/lib/engine/conversation";
import { todayISO } from "@/lib/engine/util";
import { buildView } from "@/lib/engine/view";

export const runtime = "nodejs";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Applies the one deterministic fix for a finding. No LLM involved: the server recomputes the finding from the
 * state the browser sends, builds the patch, applies it, and re-runs the checks.
 */
export async function POST(req: Request) {
  let body: { state?: unknown; rule_id?: unknown; field?: unknown; today?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const today = typeof body.today === "string" && ISO.test(body.today) ? body.today : todayISO();
  try {
    const conv = new Conversation(null, today, (body.state as ConversationState | null) ?? null);
    if (conv.phase === "booked") return NextResponse.json({ error: "This shipment is already booked." }, { status: 409 });
    const finding = conv.liveFindings().find((f) => f.rule_id === body.rule_id && f.field === body.field)
      ?? [...(conv.lastReport?.red ?? []), ...(conv.lastReport?.amber ?? [])].find((f) => f.rule_id === body.rule_id && f.field === body.field);
    if (!finding) return NextResponse.json({ error: "That finding no longer applies." }, { status: 409 });
    const fix = proposeFix(conv.shipment, finding, today);
    if (!fix) return NextResponse.json({ error: "This one needs your input; it can't be fixed automatically." }, { status: 422 });
    const { errors } = conv.applyPatch(fix.ops);
    if (errors.length) return NextResponse.json({ error: errors[0] }, { status: 422 });
    conv.stale.clear(); // the user chose these exact numbers; don't re-ask about totals
    const reply = conv.handleOps([]);
    return NextResponse.json({ reply, note: fix.note, state: conv.toState(), view: buildView(conv) });
  } catch {
    return NextResponse.json({ error: "Couldn't apply that fix. Start a new booking and try again." }, { status: 400 });
  }
}
