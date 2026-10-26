"use client";
import type { Finding } from "@/lib/engine/models";
import type { PreflightReport } from "@/lib/engine/report";

export const EMOJI = { READY: "🟩", REVIEW: "🟧", BLOCKED: "🟥" } as const;
export const STATUS_TEXT = { READY: "Ready to book", REVIEW: "Review warnings", BLOCKED: "Blocked: fix required" } as const;

export function download(filename: string, text: string, mime = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function FindingCard({ f }: { f: Finding }) {
  const kind = f.severity.toLowerCase();
  return (
    <div className={`finding ${kind}`}>
      <span className={`pill ${kind}`}>{f.severity.toUpperCase()}</span>
      <span className="pill rule">{f.rule_id}</span>
      <span className="t">{f.title}</span>
      <div className="d">{f.detail}</div>
      <div className="f"><b>How to fix:</b> {f.fix}</div>
    </div>
  );
}

function Banner({ r }: { r: PreflightReport }) {
  const sub = {
    READY: "All 10 checks passed.",
    REVIEW: `${r.amber.length} warning(s). You can proceed, but check them first.`,
    BLOCKED: `${r.red.length} blocking issue(s)${r.amber.length ? ` and ${r.amber.length} warning(s)` : ""}. This must not ship until fixed.`,
  }[r.status];
  return (
    <div className={`banner ${r.status}`}>
      <span className="big">{EMOJI[r.status]}</span>
      <div>{STATUS_TEXT[r.status]}<small>{sub}</small></div>
    </div>
  );
}

export function ReportView({ report, priority, stem, heading = true }: { report: PreflightReport; priority: string | null; stem: string; heading?: boolean }) {
  const rec = report.recommended_carrier;
  const all = [...report.red, ...report.amber];
  return (
    <div>
      <Banner r={report} />
      {all.length ? all.map((f, i) => <FindingCard key={`${f.rule_id}-${i}`} f={f} />) : (
        <div className="finding green"><span className="pill green">PASS</span><span className="t">No issues found</span>
          <div className="d">Every rule R-01 to R-10 passed.</div></div>
      )}
      {rec ? (
        <>
          {heading && <h3 style={{ margin: "18px 0 4px" }}>Recommended carrier</h3>}
          <div className="carrier">
            <div className="top">
              <div><span className="name">{rec.carrier}</span> <span className="svc">· {rec.service}</span></div>
              <span className={`tag ${report.provisional ? "prov" : ""}`}>
                {report.provisional ? "Provisional: changes once red issues are fixed" : `Recommended for '${priority ?? "Balanced"}'`}
              </span>
            </div>
            <div className="stats">
              <div className="stat"><div className="v">£{rec.cost_gbp.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div><div className="l">Total cost</div></div>
              <div className="stat"><div className="v">{rec.transit_days} day{rec.transit_days !== 1 ? "s" : ""}</div><div className="l">Transit time</div></div>
              <div className="stat"><div className="v">{rec.on_time_pct}%</div><div className="l">On-time rate</div></div>
              <div className="stat"><div className="v">{rec.max_pallet_kg} kg</div><div className="l">Max per pallet</div></div>
            </div>
            <div className="why">{report.justification}</div>
          </div>
          {report.alternatives.length > 0 && (
            <details className="exp">
              <summary>Other options ({report.alternatives.length})</summary>
              <div className="body tbl-wrap">
                <table className="tbl">
                  <thead><tr><th>Carrier</th><th>Service</th><th>Cost £</th><th>Transit days</th><th>On-time %</th><th>Max kg/pallet</th></tr></thead>
                  <tbody>{report.alternatives.map((o) => (
                    <tr key={o.carrier + o.service}><td>{o.carrier}</td><td>{o.service}</td><td>{o.cost_gbp.toFixed(2)}</td><td>{o.transit_days}</td><td>{o.on_time_pct}</td><td>{o.max_pallet_kg}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </details>
          )}
        </>
      ) : (
        <div className="note">{report.justification}</div>
      )}
      <details className="exp" open={report.status !== "BLOCKED"}>
        <summary>Confirmation summary (plain language)</summary>
        <div className="body"><div className="pre">{report.summary}</div></div>
      </details>
      <div className="row-btns">
        <button className="btn small" onClick={() => download(`${stem}_confirmation.txt`, report.summary)}>Download summary</button>
        <button className="btn small" onClick={() => download(`${stem}_preflight.json`, JSON.stringify(report, null, 2), "application/json")}>Download JSON</button>
      </div>
    </div>
  );
}
