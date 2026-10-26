"use client";
import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";
import { proposeFix } from "@/lib/engine/autofix";
import type { ConversationState } from "@/lib/engine/conversation";
import { ledgerRows, type Stamp as StampName } from "@/lib/engine/ledger";
import type { BookingView } from "@/lib/engine/view";
import { useSession, useSessionRef, useSessionState } from "./SessionProvider";
import { STATUS_STAMP, Stamp, toCtx, type Ctx, type StampKind } from "./ui";

const STAMPS: Record<StampName, { kind: StampKind; text: string }> = {
  RED: { kind: "red", text: "[RED - BLOCKING]" },
  AMBER: { kind: "amber", text: "[AMBER - WARNING]" },
  PASS: { kind: "green", text: "[PASS]" },
  PENDING: { kind: "grey", text: "[PENDING]" },
};

export default function LedgerWindow({ ctx }: { ctx: Ctx | null }) {
  const { today, setCtx } = useSession();
  const [, setState] = useSessionState<ConversationState | null>("chat.state", null);
  const [, setView] = useSessionState<BookingView | null>("chat.view", null);
  const [, setMsgs] = useSessionState<{ role: "user" | "assistant"; text: string }[]>("chat.msgs", []);
  const stateRef = useSessionRef<ConversationState | null>("chat.ref", null);
  const [fixing, setFixing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cleared, setCleared] = useState<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  /** Sends the finding to /api/fix, which patches the chat state deterministically and re-runs the rules. */
  async function autoFix(ruleId: string, field: string, note: string) {
    const key = `${ruleId}|${field}`;
    setFixing(key); setError(null);
    try {
      const res = await fetch("/api/fix", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: stateRef.current, rule_id: ruleId, field, today }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't apply that fix.");
      const before = new Set((ctx?.findings ?? []).map((f) => f.rule_id));
      const next: ConversationState = data.state;
      const nctx = toCtx(next, data.view);
      stateRef.current = next;
      setState(next); setView(data.view); setCtx(nctx);
      setMsgs((m) => [...m, { role: "assistant", text: `AUTO-FIX APPLIED: ${data.note ?? note} Rules re-checked.` }]);
      const still = new Set(nctx.findings.map((f) => f.rule_id));
      setCleared([...before].filter((r) => !still.has(r)));
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCleared([]), 3500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't apply that fix.");
    } finally {
      setFixing(null);
    }
  }

  if (!ctx) {
    return <div className="empty">LEDGER IDLE.<br />Describe a booking in the Telegraph, or select an uploaded booking in the Manifest Inspector. All ten rules are audited here, live.</div>;
  }
  const rows = ledgerRows(ctx.findings, ctx.complete);
  const count = (s: StampName) => rows.filter((r) => r.stamp === s).length;
  const status = ctx.report ? STATUS_STAMP[ctx.report.status] : null;
  return (
    <div className="ledger">
      <div className="ledger-head">
        <span className="mono small">AUDITING: <b>{ctx.label}</b>{ctx.complete ? "" : " (draft: rules marked PENDING until the booking is complete)"}</span>
        <span className="ledger-tally">
          {status && <Stamp kind={status.kind}>{status.text}</Stamp>}
          <span className="mono small">RED {count("RED")} · AMBER {count("AMBER")} · PASS {count("PASS")}</span>
        </span>
      </div>
      {error && <div className="notice warn" role="alert">{error}</div>}
      <div className="tbl-wrap" role="region" aria-label="Rule ledger (scrollable table)" tabIndex={0}>
        <table className="grid">
          <thead><tr><th>RULE</th><th>CHECK</th><th>SEV</th><th>STATUS</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const s = STAMPS[r.stamp];
              return (
                <Fragment key={r.id}>
                  <tr className={`${r.stamp === "RED" ? "row-red" : r.stamp === "AMBER" ? "row-amber" : ""}${cleared.includes(r.id) ? " row-fixed" : ""}`}>
                    <td className="mono"><b>{r.id}</b></td><td>{r.rule}</td><td className="mono">{r.severity.toUpperCase()}</td>
                    <td><Stamp kind={s.kind}>{s.text}</Stamp></td>
                  </tr>
                  {r.findings.map((f, i) => (
                    <tr key={`${r.id}-${i}`} className="detail">
                      <td />
                      <td colSpan={3}>
                        <div className="mono small">FIELD: <code>{f.field}</code></div>
                        <div>{f.detail}</div>
                        <div className="fix"><b>FIX:</b> {f.fix}</div>
                        {(() => {
                          const key = `${f.rule_id}|${f.field}`;
                          const fix = ctx.source === "chat" ? proposeFix(ctx.shipment, f, today) : null;
                          if (fixing === key) return <div className="fixbar"><i className="skel fix-skel" aria-hidden /><span className="mono small" role="status">Applying patch and re-running R-01 to R-10…</span></div>;
                          if (fix) {
                            return (
                              <div className="fixbar">
                                <button className="btn small primary" disabled={!!fixing} onClick={() => void autoFix(f.rule_id, f.field, fix.note)}>
                                  Auto-fix: {fix.label}
                                </button>
                                <span className="mono small">patch: <code>{JSON.stringify(fix.ops[0])}</code></span>
                              </div>
                            );
                          }
                          return (
                            <div className="fixbar mono small">
                              {ctx.source === "chat"
                                ? <>Needs your input, no safe automatic fix. <Link href="/telegraph">Correct it in the Telegraph</Link>.</>
                                : "Uploaded bookings are read-only here: correct the workbook and re-upload."}
                            </div>
                          );
                        })()}
                      </td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
