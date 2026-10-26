"use client";
import Link from "next/link";
import type { BookingView } from "@/lib/engine/view";
import ChatWindow from "../ChatWindow";
import { useSession, useSessionValue } from "../SessionProvider";
import { PageHead, Panel, Stamp } from "../ui";

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
  return (
    <>
      <PageHead code="01" title="Telegraph" lead="Describe the shipment in plain English. The operator asks only for what is missing, and re-checks after every change." />
      <div className="wrap split">
        <Panel title="Operator line" sub="Conversational intake" className="chat-panel">
          {today && <ChatWindow today={today} offline={offline} llm={llm} onContext={setCtx} hideDocket />}
        </Panel>
        <div className="stack">
          <Panel title="Live extraction" sub="What the operator has understood">
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
