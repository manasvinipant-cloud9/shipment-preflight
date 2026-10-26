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

/** A titled card. Each page is a set of these; there is no minimize/maximize any more because each tool now has its own page. */
export function Panel({ id, title, sub, actions, className = "", children }: {
  id?: string; title: string; sub?: string; actions?: React.ReactNode; className?: string; children: React.ReactNode;
}) {
  return (
    <section id={id} className={`panel ${className}`} aria-label={title}>
      <header className="titlebar">
        <h2 className="tb-title">{title}</h2>
        {sub && <span className="tb-sub">{sub}</span>}
        {actions && <span className="tb-btns">{actions}</span>}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}

export function PageHead({ code, title, lead, children }: { code: string; title: string; lead: string; children?: React.ReactNode }) {
  return (
    <header className="phead">
      <div className="wrap phead-in">
        <div>
          <span className="stencil-tag" aria-hidden>{code}</span>
          <h1>{title}</h1>
          <p className="phead-lead">{lead}</p>
        </div>
        {children && <div className="phead-actions">{children}</div>}
      </div>
    </header>
  );
}
