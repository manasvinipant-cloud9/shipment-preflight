"use client";
import { useEffect, useRef, useState } from "react";
import type { ConversationState } from "@/lib/engine/conversation";
import type { BookingView } from "@/lib/engine/view";
import { EXAMPLE_MISTAKES, exampleClean, exampleNl } from "@/lib/examples";
import { useSession, useSessionRef, useSessionState } from "./SessionProvider";
import { STATUS_STAMP, Stamp, download, toCtx, type Ctx } from "./ui";

const STEPS = ["Parsing shipping manifest…", "Running Rulebook R-01 through R-10…", "Matching ratio-normalized rate cards…"];

/** Step-by-step micro-messages with a skeleton of the reply. The steps are timed, not streamed: the API answers in one go. */
function Working() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = [setTimeout(() => setI(1), 1100), setTimeout(() => setI(2), 2600)];
    return () => t.forEach(clearTimeout);
  }, []);
  return (
    <div className="line assistant working" role="status">
      <span className="who">Operator</span>
      <span className="txt">
        <span className="steps-live">
          {STEPS.map((s, n) => (
            <span key={s} className={n < i ? "done" : n === i ? "now" : "later"}>
              {n < i ? <i className="tick" aria-hidden>✓</i> : n === i ? <span className="spin" aria-hidden /> : <i className="tick" aria-hidden>○</i>}
              {s}
            </span>
          ))}
        </span>
        <span className="skel-lines" aria-hidden><i className="skel" style={{ width: "92%" }} /><i className="skel" style={{ width: "74%" }} /><i className="skel" style={{ width: "48%" }} /></span>
      </span>
    </div>
  );
}

type Msg = { role: "user" | "assistant"; text: string };

const WELCOME =
  "TELEGRAPH ONLINE. Tell me about your shipment from the UK to Germany, France or the Netherlands: where it's going, pallets, " +
  "weight, and each product with its HS code, quantity and price. I'll ask only for what's missing and check everything before it goes anywhere.";

export default function ChatWindow({ today, offline, llm, onContext, hideDocket = false }: {
  today: string; offline: boolean; llm: boolean; onContext: (c: Ctx | null) => void;
  /** The Telegraph page shows the same data in its live extraction panel, so it hides the inline docket. */
  hideDocket?: boolean;
}) {
  // Chat state lives in the session so it survives moving to the Customs / Freight pages and back.
  const [msgs, setMsgs] = useSessionState<Msg[]>("chat.msgs", [{ role: "assistant", text: WELCOME }]);
  const [state, setState] = useSessionState<ConversationState | null>("chat.state", null);
  const [view, setView] = useSessionState<BookingView | null>("chat.view", null);
  const { takeLaunch } = useSession();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useSessionState<boolean>("chat.busy", false);
  const [, setDraft] = useSessionState<string>("chat.draft", "");
  const [failed, setFailed] = useState(false);
  const stateRef = useSessionRef<ConversationState | null>("chat.ref", null); // lets multi-step examples chain without stale state
  const logRef = useRef<HTMLDivElement>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const onDraft = (v: string) => { clearTimeout(draftTimer.current); draftTimer.current = setTimeout(() => setDraft(v), 300); };

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
        reply = reply.replace(r.summary, `PRE-FLIGHT DONE: ${r.status}. See the Customs and Freight pages. ${nxt}`);
      }
      if (reply.startsWith("Sorry, I couldn't read")) setFailed(true);
      setMsgs((m) => [...m, { role: "assistant", text: reply }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "assistant", text: `LINE ERROR (${e instanceof Error ? e.message : "network error"}). Nothing was changed.` }]);
    } finally {
      setBusy(false);
    }
  }

  // A quick-launch pressed on the Overview page runs here, once, after the Telegraph mounts.
  useEffect(() => {
    const k = takeLaunch();
    if (!k) return;
    void (async () => {
      if (k === "clean") await send(exampleClean(today));
      else if (k === "mistakes") await send(EXAMPLE_MISTAKES);
      else { await send(exampleClean(today)); await send("add a pallet"); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit() {
    const t = input;
    clearTimeout(draftTimer.current);
    setInput(""); setDraft("");
    await send(t);
  }

  function reset() {
    stateRef.current = null;
    setState(null); setView(null); setFailed(false); setInput(""); setDraft("");
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

      <div className="log" ref={logRef} role="log" aria-live="polite" aria-label="Conversation" tabIndex={0}>
        {msgs.map((m, i) => (
          <div key={i} className={`line ${m.role}`}>
            <span className="who">{m.role === "assistant" ? "Operator" : "Seller"}</span>
            <span className="txt">{m.text}</span>
          </div>
        ))}
        {busy && <Working />}
      </div>
      {failed && <div className="notice warn">GEMINI CALL FAILED. Check <code>GEMINI_API_KEY</code> and quota in Vercel, or switch on Offline mode (START ▸ Control Panel).</div>}

      {!hideDocket && state && view && (
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
          <pre className="slip-text" tabIndex={0} aria-label="Confirmation summary">{report.summary}</pre>
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
          onChange={(e) => { setInput(e.target.value); onDraft(e.target.value); }}
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
