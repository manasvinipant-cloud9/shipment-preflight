"use client";
import { Fragment } from "react";
import { ledgerRows, type Stamp as StampName } from "@/lib/engine/ledger";
import { STATUS_STAMP, Stamp, type Ctx, type StampKind } from "./ui";

const STAMPS: Record<StampName, { kind: StampKind; text: string }> = {
  RED: { kind: "red", text: "[RED - BLOCKING]" },
  AMBER: { kind: "amber", text: "[AMBER - WARNING]" },
  PASS: { kind: "green", text: "[PASS]" },
  PENDING: { kind: "grey", text: "[PENDING]" },
};

export default function LedgerWindow({ ctx }: { ctx: Ctx | null }) {
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
      <div className="tbl-wrap" role="region" aria-label="Rule ledger (scrollable table)" tabIndex={0}>
        <table className="grid">
          <thead><tr><th>RULE</th><th>CHECK</th><th>SEV</th><th>STATUS</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const s = STAMPS[r.stamp];
              return (
                <Fragment key={r.id}>
                  <tr className={r.stamp === "RED" ? "row-red" : r.stamp === "AMBER" ? "row-amber" : ""}>
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
