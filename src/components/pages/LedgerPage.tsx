"use client";
import Link from "next/link";
import { ledgerRows } from "@/lib/engine/ledger";
import LedgerWindow from "../LedgerWindow";
import { RulebookTable } from "../RateRulebook";
import { useSession } from "../SessionProvider";
import { PageHead, Panel, STATUS_STAMP, Stamp } from "../ui";

export default function LedgerPage() {
  const { ctx } = useSession();
  const rows = ctx ? ledgerRows(ctx.findings, ctx.complete) : null;
  const n = (s: string) => rows?.filter((r) => r.stamp === s).length ?? 0;
  const status = ctx?.report ? STATUS_STAMP[ctx.report.status] : null;
  return (
    <>
      <PageHead code="02" title="Customs and compliance ledger" lead="Rules R-01 to R-10, audited live. Red blocks a booking, Amber warns. Every finding names the field and the fix." />
      <div className="wrap with-side">
        <aside className="side" aria-label="Ledger summary">
          <div className="side-card">
            <span className="label">Auditing</span>
            <b className="side-v">{ctx ? ctx.label : "Nothing selected"}</b>
            {status && <Stamp kind={status.kind}>{status.text}</Stamp>}
            <dl className="side-tally mono">
              <div className="t-red"><dt>Red</dt><dd>{n("RED")}</dd></div>
              <div className="t-amber"><dt>Amber</dt><dd>{n("AMBER")}</dd></div>
              <div className="t-green"><dt>Pass</dt><dd>{n("PASS")}</dd></div>
              <div><dt>Pending</dt><dd>{n("PENDING")}</dd></div>
            </dl>
          </div>
          <nav className="side-card side-links" aria-label="On this page">
            <a href="#ledger">Live ledger</a><a href="#rulebook">Rulebook</a>
          </nav>
        </aside>
        <div className="stack">
          <Panel id="ledger" title="Ledger" sub="Live rule evaluation">
            <LedgerWindow ctx={ctx} />
            {!ctx && (
              <div className="row-btns"><Link className="btn primary" href="/telegraph">Describe a booking</Link><Link className="btn" href="/manifest">Upload a batch</Link></div>
            )}
          </Panel>
          <Panel id="rulebook" title="Rulebook" sub="Sheet 4: exactly what every booking is checked against"><RulebookTable /></Panel>
        </div>
      </div>
    </>
  );
}
