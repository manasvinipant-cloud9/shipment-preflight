"use client";
import { useEffect, useRef, useState } from "react";
import type { ConversationState } from "@/lib/engine/conversation";
import type { BookingView } from "@/lib/engine/view";
import { EXAMPLE_MISTAKES, exampleClean, exampleNl } from "@/lib/examples";
import { STATUS_STAMP, Stamp, download, type Ctx } from "./ui";

type Msg = { role: "user" | "assistant"; text: string };

const WELCOME =
  "TELEGRAPH ONLINE. Tell me about your shipment from the UK to Germany, France or the Netherlands: where it's going, pallets, " +
  "weight, and each product with its HS code, quantity and price. I'll ask only for what's missing and check everything before it goes anywhere.";

function toCtx(state: ConversationState, view: BookingView): Ctx {
  const r = state.phase === "collecting" ? null : state.last_report;
  return {
    source: "chat", label: "Telegraph session", shipment: state.shipment, priority: state.shipment.priority,
    findings: r ? [...r.red, ...r.amber] : view.live, complete: !!r, report: r,
  };
}

export default function ChatWindow({ today, offline, llm, onContext }: {
  today: string; offline: boolean; llm: boolean; onContext: (c: Ctx | null) => void;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([{ role: "assistant", text: WELCOME }]);
  const [state, setState] = useState<ConversationState | null>(null);
  const [view, setView] = useState<BookingView | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const stateRef = useRef<ConversationState | null>(null); // lets multi-step examples chain without stale state
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" }); }, [msgs, busy]);

  async function send(text: string) {
    if (!text.trim()) return;
    setMsgs((m) => [...m, { role: "user", text }]);
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, state: stateRef.current, today, offline }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
      const next: ConversationState = data.state;
      stateRef.current = next;
      setState(next);
      setView(data.view);
      onContext(toCtx(next, data.view));
      let reply: string = data.reply;
      const r = next.last_report;
      if (r && reply.includes(r.summary)) { // the full slip is shown below the log; keep the line short
        const nxt = r.status !== "BLOCKED" ? "Press CONFIRM BOOKING, or send corrections." : "Send the corrections and I'll re-check straight away.";
        reply = reply.replace(r.summary, `PRE-FLIGHT DONE: ${r.status}. See the Ledger and Rate Matrix windows. ${nxt}`);
      }
      if (reply.startsWith("Sorry, I couldn't read")) setFailed(true);
      setMsgs((m) => [...m, { role: "assistant", text: reply }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "assistant", text: `LINE ERROR (${e instanceof Error ? e.message : "network error"}). Nothing was changed.` }]);
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    const t = input;
    setInput("");
    await send(t);
  }

  function reset() {
    stateRef.current = null;
    setState(null); setView(null); setFailed(false); setInput("");
    setMsgs([{ role: "assistant", text: WELCOME }]);
    onContext(null);
  }

  const report = state && state.phase !== "collecting" ? state.last_report : null;
  const st = report ? STATUS_STAMP[report.status] : null;

  return (
    <div className="chat">
      {!llm && !offline && (
        <div className="notice">NO GEMINI KEY ON SERVER: the offline parser is reading messages (<code>field: value</code> lines, which the Quick Launch buttons use).
          Add <code>GEMINI_API_KEY</code> in Vercel for plain English.</div>
      )}
      {offline && <div className="notice">OFFLINE MODE: keyless parser in use. Switch it off in START ▸ Control Panel for plain English.</div>}

      <div className="launch">
        <span className="label">QUICK LAUNCH</span>
        <button className="btn" disabled={busy} title="A complete, correct booking" onClick={() => send(exampleClean(today))}>▶ Clean booking</button>
        <button className="btn" disabled={busy} title="Dangerous goods, wrong totals, short HS code, past date, overweight pallet" onClick={() => send(EXAMPLE_MISTAKES)}>▶ Booking with mistakes</button>
        <button className="btn" disabled={busy} title="Loads the clean booking, then adds a pallet" onClick={async () => { await send(exampleClean(today)); await send("add a pallet"); }}>▶ Change mid-chat</button>
        <button className="btn" disabled={busy || !llm || offline} title={llm && !offline ? "Free-text booking via Gemini" : "Needs Gemini (set GEMINI_API_KEY)"} onClick={() => send(exampleNl(today))}>▶ Plain English</button>
      </div>

      <div className="log" ref={logRef} aria-live="polite">
        {msgs.map((m, i) => (
          <div key={i} className={`line ${m.role}`}>
            <span className="who">{m.role === "assistant" ? "Operator" : "Seller"}</span>
            <span className="txt">{m.text}</span>
          </div>
        ))}
        {busy && <div className="line assistant"><span className="who">Operator</span><span className="txt"><span className="spin" />checking…</span></div>}
      </div>
      {failed && <div className="notice warn">GEMINI CALL FAILED. Check <code>GEMINI_API_KEY</code> and quota in Vercel, or switch on Offline mode (START ▸ Control Panel).</div>}

      {state && view && (
        <details className="docket">
          <summary>BOOKING DOCKET · {view.done}/{view.total} details · {view.items.length} item(s){view.route ? ` · ${view.route}` : ""}</summary>
          <div className="chips">
            {view.fields.map((f) => <span key={f.label} className={`chip ${f.value === null ? "empty" : "full"}`}><b>{f.label}</b> {f.value ?? "-"}</span>)}
          </div>
          {view.items.map((i) => <div key={i.sku} className="mono small">{i.sku} · {i.description} · {i.quantity} × £{i.price} · HS {i.hs}</div>)}
        </details>
      )}

      {report && st && (
        <div className="slip">
          <div className="slip-head"><Stamp kind={st.kind}>{st.text}</Stamp>
            <span className="mono small">{report.red.length} red · {report.amber.length} amber</span></div>
          <pre className="slip-text">{report.summary}</pre>
          <div className="row-btns">
            {state?.phase === "confirming" && report.status !== "BLOCKED" && <button className="btn primary" disabled={busy} onClick={() => send("confirm")}>CONFIRM BOOKING</button>}
            {state?.phase === "booked" && <Stamp kind="green">[BOOKED]</Stamp>}
            <button className="btn" onClick={() => download("booking_confirmation.txt", report.summary)}>Save summary</button>
            <button className="btn" onClick={() => download("booking_preflight.json", JSON.stringify(report, null, 2), "application/json")}>Save JSON</button>
          </div>
        </div>
      )}

      <div className="composer">
        <textarea
          value={input} rows={2} placeholder="Describe your shipment, or answer the operator…" aria-label="Message"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!busy) void submit(); } }}
        />
        <div className="composer-btns">
          <button className="btn primary" disabled={busy || !input.trim()} onClick={() => void submit()}>SEND</button>
          <button className="btn" onClick={reset}>NEW</button>
        </div>
      </div>
      <div className="mono small hint">Enter = send · Shift+Enter = new line</div>
    </div>
  );
}
