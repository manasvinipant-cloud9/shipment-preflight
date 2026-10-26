"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Conversation, type ConversationState } from "@/lib/engine/conversation";
import { ruleBasedExtract } from "@/lib/engine/extractor";
import { buildView, type BookingView } from "@/lib/engine/view";
import ChatWindow from "../ChatWindow";
import { useSession, useSessionValue } from "../SessionProvider";
import { PageHead, Panel, Stamp } from "../ui";

type Pill = { key: string; label: string; value: string; fresh: boolean; draft: boolean };

/** What the operator would read from the text still in the composer. Runs the keyless parser in the browser: no quota, no round trip. */
function useDraftView(draft: string, state: ConversationState | null, today: string): BookingView | null {
  const [preview, setPreview] = useState<BookingView | null>(null);
  useEffect(() => {
    let live = true;
    if (!draft.trim() || !today) { setPreview(null); return; }
    void (async () => {
      try {
        const conv = new Conversation(null, today, state ? structuredClone(state) : null);
        const ops = await ruleBasedExtract(draft, conv.snapshot(), today);
        if (!ops.length) { if (live) setPreview(null); return; }
        conv.applyPatch(ops);
        if (live) setPreview(buildView(conv));
      } catch { if (live) setPreview(null); }
    })();
    return () => { live = false; };
  }, [draft, state, today]);
  return preview;
}

function buildPills(view: BookingView, prev: BookingView | null, draft: BookingView | null): Pill[] {
  const had = new Map(prev?.fields.map((f) => [f.label, f.value]));
  const pills: Pill[] = view.fields.filter((f) => f.value !== null).map((f) => ({
    key: f.label, label: f.label, value: f.value!, fresh: !!prev && had.get(f.label) !== f.value, draft: false,
  }));
  if (view.fields.some((f) => f.value !== null) || view.items.length) pills.push({ key: "ccy", label: "Currency", value: "GBP", fresh: false, draft: false });
  if (view.items.length) pills.push({ key: "items", label: "Items", value: String(view.items.length), fresh: !!prev && prev.items.length !== view.items.length, draft: false });
  if (draft) {
    const cur = new Map(view.fields.map((f) => [f.label, f.value]));
    for (const f of draft.fields) if (f.value !== null && cur.get(f.label) !== f.value) pills.push({ key: `d-${f.label}`, label: f.label, value: f.value, fresh: false, draft: true });
    if (draft.items.length > view.items.length) pills.push({ key: "d-items", label: "Items", value: String(draft.items.length), fresh: false, draft: true });
  }
  return pills;
}

function PillBar({ view, draft, busy }: { view: BookingView | null; draft: BookingView | null; busy: boolean }) {
  const prev = useRef<BookingView | null>(null);
  const before = prev.current;
  useEffect(() => { prev.current = view; }, [view]);
  const base = view ?? { fields: [], done: 0, total: 8, route: null, items: [], live: [] };
  const pills = buildPills(base, before, draft);
  if (!pills.length && !busy) return null;
  return (
    <div className="pillbar" aria-label="Details understood so far">
      {pills.map((p) => (
        <span key={p.key} className={`pill ${p.draft ? "draft" : "ok"} ${p.fresh ? "fresh" : ""}`}>
          <i aria-hidden>{p.draft ? "…" : "✓"}</i><b>{p.label}</b> {p.value}
          {p.draft && <span className="sr-only"> (from the text you are typing, not yet sent)</span>}
        </span>
      ))}
      {busy && <><i className="skel pill-skel" aria-hidden /><i className="skel pill-skel" aria-hidden style={{ width: 96 }} /></>}
    </div>
  );
}

function Extraction({ view }: { view: BookingView | null }) {
  if (!view) {
    return <div className="empty">NOTHING EXTRACTED YET.<br />As you describe the shipment, each detail appears here the moment it is understood, so you can see what the operator has, and what it still needs.</div>;
  }
  const pct = Math.round((view.done / view.total) * 100);
  return (
    <div className="extract">
      <div className="extract-prog">
        <span className="mono small"><b>{view.done}/{view.total}</b> details{view.route ? ` · ${view.route}` : ""}</span>
        <span className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={view.total} aria-valuenow={view.done} aria-label="Booking details captured"><i style={{ width: `${pct}%` }} /></span>
      </div>
      <dl className="kv">
        {view.fields.map((f) => (
          <div key={f.label} className={f.value === null ? "missing" : "have"}>
            <dt>{f.label}</dt>
            <dd className="mono">{f.value ?? "Missing"}<span className="sr-only">{f.value === null ? " (not captured yet)" : " (captured)"}</span></dd>
            <span className="mark" aria-hidden>{f.value === null ? "○" : "✓"}</span>
          </div>
        ))}
      </dl>
      {view.items.length > 0 && (
        <div className="tbl-wrap" role="region" aria-label="Extracted items (scrollable)" tabIndex={0}>
          <table className="grid">
            <thead><tr><th>SKU</th><th>Item</th><th>Qty</th><th>£/unit</th><th>HS</th></tr></thead>
            <tbody>{view.items.map((i) => (
              <tr key={i.sku}><td className="mono">{i.sku}</td><td>{i.description}</td><td className="mono">{i.quantity}</td><td className="mono">{i.price}</td><td className="mono">{i.hs}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {view.live.length > 0 && (
        <div className="heads-up" role="status">
          <span className="label">Findings so far</span>
          <ul>{view.live.map((f, i) => (
            <li key={f.rule_id + i}><Stamp kind={f.severity === "Red" ? "red" : "amber"}>{f.severity === "Red" ? "[RED - BLOCKING]" : "[AMBER - WARNING]"}</Stamp> <b className="mono">{f.rule_id}</b> {f.title}<div className="fix"><b>FIX:</b> {f.fix}</div></li>
          ))}</ul>
        </div>
      )}
    </div>
  );
}

export default function TelegraphPage() {
  const { today, offline, llm, setCtx, ctx } = useSession();
  const view = useSessionValue<BookingView | null>("chat.view", null);
  const state = useSessionValue<ConversationState | null>("chat.state", null);
  const draftText = useSessionValue<string>("chat.draft", "");
  const busy = useSessionValue<boolean>("chat.busy", false);
  const draft = useDraftView(draftText, state, today);
  return (
    <>
      <PageHead code="01" title="Telegraph" lead="Describe the shipment in plain English. The operator asks only for what is missing, and re-checks after every change." />
      <div className="wrap split">
        <Panel title="Operator line" sub="Conversational intake" className="chat-panel">
          {today && <ChatWindow today={today} offline={offline} llm={llm} onContext={setCtx} hideDocket />}
        </Panel>
        <div className="stack">
          <Panel title="Live extraction" sub="What the operator has understood">
            <PillBar view={view} draft={draft} busy={busy} />
            <Extraction view={view} />
          </Panel>
          {ctx?.source === "chat" && ctx.complete && (
            <div className="next-links">
              <Link className="btn primary" href="/ledger">Review customs findings</Link>
              <Link className="btn" href="/freight">Compare carriers</Link>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
