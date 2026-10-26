"use client";
import type { Finding, Shipment } from "@/lib/engine/models";
import type { PreflightReport } from "@/lib/engine/report";

/** What the Ledger and Rate Matrix windows are currently looking at: the chat session or a selected uploaded booking. */
export interface Ctx {
  source: "chat" | "batch";
  label: string;
  shipment: Shipment;
  priority: string | null;
  findings: Finding[];
  complete: boolean; // a full pre-flight ran (rules without findings PASS)
  report: PreflightReport | null;
}

export type StampKind = "red" | "amber" | "green" | "grey";

export function Stamp({ kind, children }: { kind: StampKind; children: React.ReactNode }) {
  return <span className={`stamp ${kind}`}>{children}</span>;
}

export const STATUS_STAMP = {
  READY: { kind: "green", text: "[READY TO BOOK]" },
  REVIEW: { kind: "amber", text: "[REVIEW - WARNINGS]" },
  BLOCKED: { kind: "red", text: "[BLOCKED - FIX REQUIRED]" },
} as const;

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

export const gbp = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function Win({
  id, title, sub, minimized, maximized, onMin, onMax, children,
}: {
  id: string; title: string; sub: string; minimized: boolean; maximized: boolean;
  onMin: () => void; onMax: () => void; children: React.ReactNode;
}) {
  return (
    <section id={`win-${id}`} className={`win win-${id}${maximized ? " max" : ""}${minimized ? " min" : ""}`} aria-label={title}>
      <header className="titlebar">
        <h3 className="tb-title">{title}</h3>
        <span className="tb-sub">{sub}</span>
        <span className="tb-btns">
          <button className="tb-btn" aria-label={`${minimized ? "Restore" : "Minimize"} ${title}`} aria-expanded={!minimized} onClick={onMin}>{minimized ? "＋" : "－"}</button>
          <button className="tb-btn" aria-label={`${maximized ? "Restore size of" : "Maximize"} ${title}`} aria-pressed={maximized} onClick={onMax}>{maximized ? "⤡" : "⤢"}</button>
        </span>
      </header>
      <div className="win-body" hidden={minimized}>{children}</div>
    </section>
  );
}
