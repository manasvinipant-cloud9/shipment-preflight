"use client";
import { useRef, useState } from "react";
import { DEFAULT_RATE_CARD } from "@/lib/engine/carriers";
import { confirmationsText, findingsCsv, type BatchRow } from "@/lib/engine/export";
import { RULEBOOK } from "@/lib/engine/rules";
import { SAMPLE_NOTES } from "@/lib/examples";
import { EMOJI, ReportView, STATUS_TEXT, download } from "./ReportView";

type Filter = "All" | "Blocked" | "Review" | "Ready";

export default function BatchTab({ today }: { today: string }) {
  const [rows, setRows] = useState<BatchRow[] | null>(null);
  const [fileNotes, setFileNotes] = useState<string[]>([]);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("All");
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function run(files: File[], name: string) {
    if (!files.length) return;
    setBusy(true); setError("");
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append("files", f));
      fd.append("today", today);
      const res = await fetch("/api/batch", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't process that file.");
      setRows(data.rows); setFileNotes(data.fileNotes ?? []); setLabel(name); setFilter("All");
    } catch (e) {
      setRows(null);
      setError(e instanceof Error ? e.message : "Couldn't process that file.");
    } finally {
      setBusy(false);
    }
  }

  async function runSample() {
    const res = await fetch("/samples/test_bookings_items.xlsx");
    const blob = await res.blob();
    await run([new File([blob], "test_bookings_items.xlsx")], "the sample workbook");
  }

  const counts = { READY: 0, REVIEW: 0, BLOCKED: 0 };
  rows?.forEach((r) => { counts[r.report.status]++; });
  const shown = (rows ?? []).filter((r) => filter === "All" || r.report.status === filter.toUpperCase());

  return (
    <div>
      <p style={{ marginTop: 0 }}>Upload the <b>Bookings + Items</b> workbook (the Case 2 template: <code>.xlsx</code>, <code>.ods</code>) or a Bookings CSV and an
        Items CSV. Every booking is checked against the rate card and rulebook below. No API key is needed for this tab.</p>

      <div
        className={`drop ${over ? "over" : ""}`}
        onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); const fs = [...e.dataTransfer.files]; void run(fs, fs.map((f) => f.name).join(" + ")); }}
      >
        <b>Drop files here</b> or click to browse<div className="caption">.xlsx · .ods · .csv (two CSVs: bookings and items)</div>
        <input ref={input} type="file" multiple hidden accept=".xlsx,.xlsm,.ods,.csv"
          onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ""; void run(fs, fs.map((f) => f.name).join(" + ")); }} />
      </div>
      <div className="row-btns">
        <button className="btn primary" disabled={busy} onClick={() => void runSample()}>Run sample workbook</button>
        <a className="btn" href="/samples/test_bookings_items.xlsx" download>Download sample</a>
        {busy && <span style={{ alignSelf: "center" }}><span className="spinner" />Checking…</span>}
      </div>

      <details className="exp"><summary>What each sample booking tests</summary>
        <div className="body tbl-wrap"><table className="tbl"><thead><tr><th>Booking</th><th>What it tests</th></tr></thead>
          <tbody>{SAMPLE_NOTES.map((n) => <tr key={n.booking}><td>{n.booking}</td><td>{n.tests}</td></tr>)}</tbody></table></div></details>
      <details className="exp"><summary>Rate card (Sheet 3) and rulebook (Sheet 4) in use</summary>
        <div className="body">
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Carrier</th><th>Service</th><th>To</th><th>£/pallet</th><th>Days</th><th>On-time %</th><th>Max kg/pallet</th></tr></thead>
            <tbody>{DEFAULT_RATE_CARD.map((l) => <tr key={l.name + l.destination}><td>{l.name}</td><td>{l.service}</td><td>{l.destination}</td><td>{l.price_per_pallet.toString()}</td><td>{l.transit_days}</td><td>{l.on_time_pct.toString()}</td><td>{l.max_pallet_kg.toString()}</td></tr>)}</tbody></table></div>
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Rule</th><th>Check</th><th>If broken</th></tr></thead>
            <tbody>{RULEBOOK.map(([id, text, sev]) => <tr key={id}><td>{id}</td><td>{text}</td><td>{sev}</td></tr>)}</tbody></table></div>
        </div></details>

      {error && <div className="err">🚫 {error}</div>}
      {!rows && !error && !busy && <p className="caption">Nothing uploaded yet. Click <b>Run sample workbook</b> to see it work.</p>}

      {rows && (
        <div>
          <p className="caption">Checked <b>{label}</b></p>
          {fileNotes.map((n, i) => <div className="warn" key={i}>{n}</div>)}
          <div className="tiles">
            <div className="tile"><div className="v">{rows.length}</div><div className="l">Bookings checked</div></div>
            {(["READY", "REVIEW", "BLOCKED"] as const).map((k) => (
              <div className={`tile ${k}`} key={k}><div className="v">{counts[k]}</div><div className="l">{STATUS_TEXT[k]}</div></div>
            ))}
          </div>

          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Booking</th><th>Status</th><th>Seller</th><th>Route</th><th>Priority</th><th>Red</th><th>Amber</th><th>Rules hit</th><th>Recommended</th><th>Cost £</th></tr></thead>
              <tbody>{rows.map((r) => {
                const rec = r.report.recommended_carrier;
                const hit = [...new Set([...r.report.red, ...r.report.amber].map((f) => f.rule_id))].sort().join(", ") || "none";
                return (
                  <tr key={r.booking_id + r.report.summary.length}>
                    <td><b>{r.booking_id}</b></td><td>{EMOJI[r.report.status]} {STATUS_TEXT[r.report.status]}</td><td>{r.seller_name}</td>
                    <td>{r.origin_city || "UK"} → {r.destination_city || r.destination_country}</td><td>{r.priority}</td>
                    <td>{r.report.red.length}</td><td>{r.report.amber.length}</td><td>{hit}</td>
                    <td>{rec ? `${rec.carrier} (${rec.service})` : "none possible"}</td><td>{rec ? rec.cost_gbp.toFixed(2) : ""}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>

          <div className="row-btns">
            <button className="btn small" onClick={() => download("preflight_findings.csv", findingsCsv(rows), "text/csv")}>Findings (CSV)</button>
            <button className="btn small" onClick={() => download("preflight_confirmations.txt", confirmationsText(rows))}>Confirmations (TXT)</button>
            <button className="btn small" onClick={() => download("preflight_results.json", JSON.stringify(rows.map((r) => ({ ...r.report, notes: r.notes })), null, 2), "application/json")}>Full results (JSON)</button>
          </div>

          <div className="radios">{(["All", "Blocked", "Review", "Ready"] as Filter[]).map((f) => (
            <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>{f}</button>
          ))}</div>

          {shown.slice(0, 60).map((r, n) => (
            <details className="exp" key={r.booking_id + n} open={(filter !== "All" && n === 0) || shown.length === 1}>
              <summary>{EMOJI[r.report.status]} {r.booking_id} · {r.seller_name ?? ""} · {r.destination_city || r.destination_country || ""}</summary>
              <div className="body">
                {r.notes.map((note, i) => <div className="note" key={i}>⚠ {note}</div>)}
                <ReportView report={r.report} priority={r.priority} stem={r.booking_id} heading={false} />
              </div>
            </details>
          ))}
          {shown.length > 60 && <p className="caption">Showing the first 60 of {shown.length}; use the downloads for everything.</p>}
        </div>
      )}
    </div>
  );
}
