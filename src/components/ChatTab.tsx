"use client";
import { useEffect, useRef, useState } from "react";
import type { ConversationState } from "@/lib/engine/conversation";
import type { BookingView } from "@/lib/engine/view";
import { EXAMPLE_MISTAKES, exampleClean, exampleNl } from "@/lib/examples";
import { FindingCard, ReportView, STATUS_TEXT } from "./ReportView";

type Msg = { role: "user" | "assistant"; text: string };

const WELCOME =
  "Hi! Tell me about your shipment from the UK to Germany, France or the Netherlands: where it's going, pallets, weight, " +
  "and each product with its HS code, quantity and price. I'll ask only for what's missing and check everything before it goes anywhere.";

export default function ChatTab({ today, offline, llm }: { today: string; offline: boolean; llm: boolean }) {
  const [msgs, setMsgs] = useState<Msg[]>([{ role: "assistant", text: WELCOME }]);
  const [state, setState] = useState<ConversationState | null>(null);
  const [view, setView] = useState<BookingView | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const stateRef = useRef<ConversationState | null>(null); // lets multi-step examples chain without stale state
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [msgs, busy]);

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
      let reply: string = data.reply;
      const r = next.last_report;
      if (r && reply.includes(r.summary)) { // the full report is rendered below the chat; keep the bubble short
        const nxt = r.status !== "BLOCKED" ? "Reply 'confirm' to book, or send corrections." : "Send the corrections and I'll re-check straight away.";
        reply = reply.replace(r.summary, `Pre-flight done: ${STATUS_TEXT[r.status].toLowerCase()}. The full result is below the chat. ${nxt}`);
      }
      if (reply.startsWith("Sorry, I couldn't read")) setFailed(true);
      setMsgs((m) => [...m, { role: "assistant", text: reply }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "assistant", text: `Sorry, that didn't work (${e instanceof Error ? e.message : "network error"}). Nothing was changed.` }]);
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
  }

  const report = state?.last_report;
  const showReport = report && (state.phase === "confirming" || state.phase === "booked");

  return (
    <div>
      {!llm && !offline && (
        <div className="info">No Gemini API key is configured on the server, so chat runs on the <b>offline parser</b>. It understands
          <code> field: value </code> lines (the example buttons use that format). Add <code>GEMINI_API_KEY</code> in Vercel for plain-English chat.</div>
      )}
      {offline && <div className="info">Offline mode is on: chat uses the keyless parser (<code>field: value</code> lines). Turn it off in the page header for plain English.</div>}

      <div className="try">Try an example</div>
      <div className="examples">
        <button className="btn" disabled={busy} title="A complete, correct booking → ready to book" onClick={() => send(exampleClean(today))}>✅ Clean booking</button>
        <button className="btn" disabled={busy} title="Dangerous goods, wrong totals, short HS code, past date, overweight pallet" onClick={() => send(EXAMPLE_MISTAKES)}>🟥 Booking with mistakes</button>
        <button className="btn" disabled={busy} title="Loads the clean booking, then adds a pallet" onClick={async () => { await send(exampleClean(today)); await send("add a pallet"); }}>✏️ Change mid-chat</button>
        <button className="btn" disabled={busy || !llm || offline} title={llm && !offline ? "Free-text booking" : "Needs Gemini (set GEMINI_API_KEY)"} onClick={() => send(exampleNl(today))}>💬 Plain English</button>
      </div>

      <div className="chat-grid">
        <div>
          {msgs.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              <div className="avatar">{m.role === "assistant" ? "🛫" : "🧑‍💼"}</div>
              <div className="bubble">{m.text}</div>
            </div>
          ))}
          {busy && <div className="thinking"><span className="spinner" />Checking…</div>}
          {failed && <div className="warn">The language-model call failed. Check <code>GEMINI_API_KEY</code> and quota in Vercel, or switch on Offline mode in the page header.</div>}
          <div ref={endRef} />
          {state?.phase === "confirming" && report && report.status !== "BLOCKED" && (
            <div className="row-btns"><button className="btn primary" disabled={busy} onClick={() => send("confirm")}>Confirm booking</button></div>
          )}
          <div className="composer">
            <textarea
              value={input} rows={1} placeholder="Describe your shipment, or answer my question…"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!busy) void submit(); } }}
            />
            <button className="btn primary" disabled={busy || !input.trim()} onClick={() => void submit()}>Send</button>
          </div>
          <div className="caption" style={{ marginTop: 6 }}>Enter to send · Shift+Enter for a new line · <a href="#" onClick={(e) => { e.preventDefault(); reset(); }}>Start a new booking</a></div>
        </div>

        <div>
          <div className="card">
            <h4>Booking so far</h4>
            {(view?.fields ?? emptyFields).map((f) => (
              <div className="row" key={f.label}><span className="k">{f.label}</span><span className={`v${f.value === null ? " miss" : ""}`}>{f.value ?? "not yet given"}</span></div>
            ))}
            {view?.route && <div className="row"><span className="k">Route</span><span className="v">{view.route}</span></div>}
          </div>
          <div className="bar"><span style={{ width: `${((view?.done ?? 0) / (view?.total ?? 8)) * 100}%` }} /></div>
          <div className="caption" style={{ marginBottom: 12 }}>{view?.done ?? 0} of {view?.total ?? 8} booking details collected</div>
          {view && view.items.length > 0 && (
            <div className="card">
              <h4>Items ({view.items.length})</h4>
              {view.items.map((i) => (
                <div className="row" key={i.sku}><span className="k">{i.sku} · {i.description}</span><span className="v">{i.quantity} × £{i.price} · HS {i.hs}</span></div>
              ))}
            </div>
          )}
          <div className="card">
            <h4>Live checks</h4>
            {view && view.live.length ? view.live.map((f, i) => <FindingCard key={i} f={f} />) : <div className="note">No issues spotted so far.</div>}
          </div>
        </div>
      </div>

      {showReport && state && (
        <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid #e2e8f0" }}>
          {state.phase === "booked"
            ? <div className="ok">✅ Booking confirmed. The confirmation below can be downloaded.</div>
            : <div className="caption" style={{ marginBottom: 6 }}>Pre-flight result. Press <b>Confirm booking</b> (or type confirm) to book, or send corrections.</div>}
          <ReportView report={report} priority={state.shipment.priority} stem="booking" />
        </div>
      )}
    </div>
  );
}

const emptyFields = ["Destination country", "Destination type", "Ready to ship", "Pallets", "Gross weight", "Total cartons", "Declared value", "Priority"]
  .map((label) => ({ label, value: null as string | null }));
