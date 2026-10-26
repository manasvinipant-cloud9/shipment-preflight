// Download helpers (pure; used by the browser on the JSON results the batch API returns).
import type { PreflightReport } from "./report";

export interface BatchRow {
  booking_id: string;
  notes: string[];
  report: PreflightReport;
  seller_name: string | null;
  origin_city: string | null;
  destination_city: string | null;
  destination_country: string | null;
  priority: string | null;
}

const esc = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function findingsCsv(rows: BatchRow[]): string {
  const lines = [["booking_id", "seller", "status", "severity", "rule_id", "issue", "detail", "fix", "recommended_carrier", "cost_gbp", "transit_days"].join(",")];
  for (const r of rows) {
    const rec = r.report.recommended_carrier;
    const tail = rec ? [`${rec.carrier} (${rec.service})`, rec.cost_gbp.toFixed(2), rec.transit_days] : ["", "", ""];
    const fs = [...r.report.red, ...r.report.amber];
    if (!fs.length) lines.push([r.booking_id, r.seller_name, r.report.status, "", "", "No issues", "", "", ...tail].map(esc).join(","));
    for (const f of fs) lines.push([r.booking_id, r.seller_name, r.report.status, f.severity, f.rule_id, f.title, f.detail, f.fix, ...tail].map(esc).join(","));
  }
  return lines.join("\n") + "\n";
}

export function confirmationsText(rows: BatchRow[]): string {
  return rows.map((r) => `${r.booking_id}  [${r.report.status}]\n${r.report.summary}\n\nWhy this carrier: ${r.report.justification}`)
    .join("\n" + "=".repeat(78) + "\n");
}
