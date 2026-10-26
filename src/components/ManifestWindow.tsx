"use client";
import { useRef, useState } from "react";
import { DEFAULT_RATE_CARD } from "@/lib/engine/carriers";
import { confirmationsText, findingsCsv, type BatchRow } from "@/lib/engine/export";
import { RULEBOOK } from "@/lib/engine/rules";
import { SAMPLE_NOTES } from "@/lib/examples";
import { STATUS_STAMP, Stamp, download, gbp, type Ctx } from "./ui";

type Filter = "All" | "Blocked" | "Review" | "Ready";

const toCtx = (r: BatchRow): Ctx => ({
  source: "batch", label: `${r.booking_id}${r.seller_name ? ` · ${r.seller_name}` : ""}`, shipment: r.shipment, priority: r.priority,
  findings: [...r.report.red, ...r.report.amber], complete: true, report: r.report,
});

const num = (v: string | null) => (v === null ? null : Number(v));
const validHs = (hs: string | null) => !!hs && /^\d{6,}$/.test(hs.replace(/[\s.\-]/g, ""));
const r2 = (n: number) => Math.round(n * 100) / 100;

function Inspector({ row }: { row: BatchRow }) {
  const s = row.shipment;
  const st = STATUS_STAMP[row.report.status];
  const lineKg = s.items.map((i) => (i.quantity !== null && num(i.unit_weight_kg) !== null ? r2(i.quantity * num(i.unit_weight_kg)!) : null));
  const sumKg = r2(lineKg.reduce<number>((a, x) => a + (x ?? 0), 0));
  const sumCartons = s.items.reduce((a, i) => a + (i.cartons ?? 0), 0);
  const sumValue = r2(s.items.reduce((a, i) => a + (i.quantity !== null && num(i.unit_price_gbp) !== null ? i.quantity * num(i.unit_price_gbp)! : 0), 0));
  const declared = num(s.total_declared_value_gbp);
  const gross = num(s.total_gross_weight_kg);
  return (
    <div className="inspect">
      <div className="inspect-head">
        <b className="mono">{row.booking_id}</b> <span>{s.seller_name}</span>
        <span className="mono small">{s.origin_city || "UK"} → {s.destination_city || s.destination_country} · {s.destination_type}</span>
        <Stamp kind={st.kind}>{st.text}</Stamp>
      </div>
      <div className="totals mono small">
        <span>PALLETS <b>{s.pallets ?? "?"}</b></span>
        <span>CARTONS <b className={sumCartons !== s.total_cartons ? "bad" : ""}>{s.total_cartons ?? "?"}</b> (items {sumCartons})</span>
        <span>GROSS <b className={gross !== null && gross < sumKg ? "warn" : ""}>{s.total_gross_weight_kg ?? "?"} kg</b> (goods {sumKg} kg)</span>
        <span>DECLARED <b className={declared !== null && Math.abs(declared - sumValue) > sumValue * 0.01 ? "bad" : ""}>{declared === null ? "?" : gbp(declared)}</b> (items {gbp(sumValue)})</span>
        <span>READY <b>{s.ready_date ? s.ready_date.split("-").reverse().join("-") : "?"}</b></span>
        <span>APPT <b className={s.destination_type === "Warehouse" && s.delivery_appointment_booked !== "Yes" ? "warn" : ""}>{s.delivery_appointment_booked ?? "?"}</b></span>
        <span>PRIORITY <b>{s.priority}</b></span>
      </div>
      <div className="tbl-wrap">
        <table className="grid items">
          <thead><tr><th>SKU</th><th>DESCRIPTION</th><th>HS CODE</th><th>QTY</th><th>£/UNIT</th><th>UNITS/CTN</th><th>CTNS</th><th>KG/UNIT</th><th>LINE KG</th><th>ORIGIN</th></tr></thead>
          <tbody>
            {s.items.map((i, n) => (
              <tr key={i.sku + n}>
                <td className="mono">{i.sku}</td><td>{i.description}</td>
                <td className={`mono ${validHs(i.hs_code) ? "" : "bad"}`}>{i.hs_code ?? "MISSING"}</td>
                <td className="mono">{i.quantity ?? "?"}</td><td className="mono">{i.unit_price_gbp ?? "?"}</td>
                <td className="mono">{i.units_per_carton ?? "?"}</td>
                <td className={`mono ${i.units_per_carton !== null && i.cartons !== null && i.quantity !== null && i.units_per_carton * i.cartons !== i.quantity ? "bad" : ""}`}>{i.cartons ?? "?"}</td>
                <td className="mono">{i.unit_weight_kg ?? "?"}</td><td className="mono">{lineKg[n] ?? "?"}</td>
                <td className={`mono ${i.country_of_origin ? "" : "warn"}`}>{i.country_of_origin ?? "MISSING"}</td>
              </tr>
            ))}
            {s.items.length === 0 && <tr><td colSpan={10} className="empty-cell">No items found for this booking.</td></tr>}
          </tbody>
        </table>
      </div>
      {row.notes.map((n, i) => <div className="notice warn" key={i}>DATA NOTE: {n}</div>)}
      <div className="row-btns">
        <button className="btn" onClick={() => download(`${row.booking_id}_confirmation.txt`, `${row.report.summary}\n\nWhy this carrier: ${row.report.justification}`)}>Save confirmation</button>
        <button className="btn" onClick={() => download(`${row.booking_id}_preflight.json`, JSON.stringify(row.report, null, 2), "application/json")}>Save JSON</button>
      </div>
      <details className="plain"><summary>CONFIRMATION SUMMARY (plain language)</summary><pre className="slip-text">{row.report.summary}</pre></details>
    </div>
  );
}

export default function ManifestWindow({ today, onContext }: { today: string; onContext: (c: Ctx | null) => void }) {
  const [rows, setRows] = useState<BatchRow[] | null>(null);
  const [fileNotes, setFileNotes] = useState<string[]>([]);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("All");
  const [sel, setSel] = useState<string | null>(null);
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
      const got: BatchRow[] = data.rows;
      setRows(got); setFileNotes(data.fileNotes ?? []); setLabel(name); setFilter("All");
      const first = got.find((r) => r.report.status === "BLOCKED") ?? got[0];
      setSel(first.booking_id + got.indexOf(first)); onContext(toCtx(first));
    } catch (e) {
      setRows(null); setSel(null);
      setError(e instanceof Error ? e.message : "Couldn't process that file.");
    } finally {
      setBusy(false);
    }
  }

  async function runSample() {
    const blob = await (await fetch("/samples/test_bookings_items.xlsx")).blob();
    await run([new File([blob], "test_bookings_items.xlsx")], "sample workbook");
  }

  const counts = { READY: 0, REVIEW: 0, BLOCKED: 0 };
  rows?.forEach((r) => { counts[r.report.status]++; });
  const shown = (rows ?? []).map((r, i) => ({ r, key: r.booking_id + i })).filter(({ r }) => filter === "All" || r.report.status === filter.toUpperCase());
  const selected = rows?.map((r, i) => ({ r, key: r.booking_id + i })).find((x) => x.key === sel)?.r;

  return (
    <div className="manifest">
      <div className="mrow">
        <div
          className={`drop ${over ? "over" : ""}`} role="button" tabIndex={0}
          onClick={() => input.current?.click()} onKeyDown={(e) => { if (e.key === "Enter") input.current?.click(); }}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); const fs = [...e.dataTransfer.files]; void run(fs, fs.map((f) => f.name).join(" + ")); }}
        >
          <b>DROP BOOKINGS + ITEMS HERE</b> or click to browse
          <span className="mono small">.xlsx · .ods · or two .csv files (bookings, items). No API key needed.</span>
          <input ref={input} type="file" multiple hidden accept=".xlsx,.xlsm,.ods,.csv"
            onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ""; void run(fs, fs.map((f) => f.name).join(" + ")); }} />
        </div>
        <div className="mbtns">
          <button className="btn primary" disabled={busy} onClick={() => void runSample()}>RUN SAMPLE WORKBOOK</button>
          <a className="btn" href="/samples/test_bookings_items.xlsx" download>Download sample</a>
          {busy && <span className="mono small"><span className="spin" />processing…</span>}
        </div>
      </div>

      {error && <div className="notice bad">UPLOAD ERROR: {error}</div>}
      {!rows && !error && !busy && <div className="empty">MANIFEST EMPTY. Drop the Bookings + Items sheets (or run the sample) to check every booking against the rate card and rulebook.</div>}

      {rows && (
        <>
          <div className="mono small">CHECKED: <b>{label}</b></div>
          {fileNotes.map((n, i) => <div className="notice warn" key={i}>{n}</div>)}
          <div className="tally">
            <span><b>{rows.length}</b> BOOKINGS</span>
            <span className="t-green"><b>{counts.READY}</b> READY</span>
            <span className="t-amber"><b>{counts.REVIEW}</b> REVIEW</span>
            <span className="t-red"><b>{counts.BLOCKED}</b> BLOCKED</span>
            <span className="filters">{(["All", "Blocked", "Review", "Ready"] as Filter[]).map((f) => (
              <button key={f} className={`btn small ${filter === f ? "on" : ""}`} onClick={() => setFilter(f)}>{f}</button>
            ))}</span>
          </div>

          <div className="tbl-wrap list">
            <table className="grid pick">
              <thead><tr><th>BOOKING</th><th>STATUS</th><th>SELLER</th><th>ROUTE</th><th>PRIORITY</th><th>RED</th><th>AMBER</th><th>RULES HIT</th><th>RECOMMENDED</th><th>COST</th></tr></thead>
              <tbody>{shown.map(({ r, key }) => {
                const rec = r.report.recommended_carrier;
                const hit = [...new Set([...r.report.red, ...r.report.amber].map((f) => f.rule_id))].sort().join(", ") || "-";
                const st = STATUS_STAMP[r.report.status];
                return (
                  <tr key={key} className={key === sel ? "sel" : ""} tabIndex={0}
                    onClick={() => { setSel(key); onContext(toCtx(r)); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { setSel(key); onContext(toCtx(r)); } }}>
                    <td className="mono"><b>{r.booking_id}</b></td><td><Stamp kind={st.kind}>{st.text}</Stamp></td><td>{r.seller_name}</td>
                    <td>{r.origin_city || "UK"} → {r.destination_city || r.destination_country}</td><td>{r.priority}</td>
                    <td className="mono">{r.report.red.length}</td><td className="mono">{r.report.amber.length}</td><td className="mono">{hit}</td>
                    <td>{rec ? `${rec.carrier} (${rec.service})` : "none possible"}</td><td className="mono">{rec ? gbp(rec.cost_gbp) : "-"}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
          <div className="row-btns">
            <span className="label">EXPORT</span>
            <button className="btn" onClick={() => download("preflight_findings.csv", findingsCsv(rows), "text/csv")}>Findings (CSV)</button>
            <button className="btn" onClick={() => download("preflight_confirmations.txt", confirmationsText(rows))}>Confirmations (TXT)</button>
            <button className="btn" onClick={() => download("preflight_results.json", JSON.stringify(rows.map((r) => ({ ...r.report, notes: r.notes })), null, 2), "application/json")}>Full results (JSON)</button>
          </div>
          {selected && <Inspector row={selected} />}
        </>
      )}

      <details className="plain"><summary>WHAT EACH SAMPLE BOOKING TESTS</summary>
        <table className="grid"><tbody>{SAMPLE_NOTES.map((n) => <tr key={n.booking}><td className="mono"><b>{n.booking}</b></td><td>{n.tests}</td></tr>)}</tbody></table></details>
      <details className="plain"><summary>RATE CARD (SHEET 3) AND RULEBOOK (SHEET 4) IN USE</summary>
        <table className="grid"><thead><tr><th>CARRIER</th><th>SERVICE</th><th>TO</th><th>£/PALLET</th><th>DAYS</th><th>ON-TIME %</th><th>MAX KG/PALLET</th></tr></thead>
          <tbody>{DEFAULT_RATE_CARD.map((l) => <tr key={l.name + l.destination}><td>{l.name}</td><td>{l.service}</td><td>{l.destination}</td><td className="mono">{l.price_per_pallet.toString()}</td><td className="mono">{l.transit_days}</td><td className="mono">{l.on_time_pct.toString()}</td><td className="mono">{l.max_pallet_kg.toString()}</td></tr>)}</tbody></table>
        <table className="grid"><thead><tr><th>RULE</th><th>CHECK</th><th>IF BROKEN</th></tr></thead>
          <tbody>{RULEBOOK.map(([id, text, sev]) => <tr key={id}><td className="mono"><b>{id}</b></td><td>{text}</td><td className="mono">{sev.toUpperCase()}</td></tr>)}</tbody></table>
      </details>
    </div>
  );
}
