"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import type { ConversationState } from "@/lib/engine/conversation";
import { useSession, useSessionValue } from "./SessionProvider";
import { STATUS_STAMP, Stamp, gbp } from "./ui";

export const NAV = [
  { href: "/", label: "Overview", short: "Overview", code: "00" },
  { href: "/telegraph", label: "Telegraph", short: "Chat", code: "01" },
  { href: "/ledger", label: "Customs", short: "Customs", code: "02" },
  { href: "/freight", label: "Freight", short: "Freight", code: "03" },
  { href: "/manifest", label: "Manifest", short: "Batch", code: "04" },
] as const;

const STEPS = ["Intake", "Pre-flight", "Carrier", "Confirm"] as const;

/** Delhivery-style tracking strip: which booking is active, how serious it is, and how far along it is. */
function TrackingHeader() {
  const { ctx } = useSession();
  const chat = useSessionValue<ConversationState | null>("chat.state", null);
  const report = ctx?.report ?? null;

  // The index of the current step. -1 = nothing started (all steps pending), 0 = intake under way,
  // 2 = pre-flight ran, carrier is next, 3 = waiting on the seller to confirm (chat, not blocked), 4 = booked (all done).
  let at = -1;
  if (ctx) at = 0;
  if (ctx?.complete && report) at = 2;
  if (ctx?.source === "chat" && chat?.phase === "confirming" && report && report.status !== "BLOCKED") at = 3;
  if (ctx?.source === "chat" && chat?.phase === "booked") at = 4;

  const s = ctx?.shipment;
  const route = s ? `${s.origin_city || "UK"} → ${s.destination_city || s.destination_country || "destination pending"}` : null;
  const st = report ? STATUS_STAMP[report.status] : null;
  const rec = report?.recommended_carrier;

  return (
    <section className="track" aria-label="Active booking">
      <div className="wrap track-in">
        <div className="track-id">
          <span className="label">Active booking</span>
          {ctx ? (
            <>
              <b className="track-label">{ctx.label}</b>
              <span className="mono small">{route}{s?.pallets ? ` · ${s.pallets} pallet${s.pallets === 1 ? "" : "s"}` : ""}</span>
            </>
          ) : <b className="track-label dim">None yet</b>}
        </div>
        <div className="track-status">
          {st ? <Stamp kind={st.kind}>{st.text}</Stamp> : <Stamp kind="grey">{ctx ? "[DRAFT]" : "[IDLE]"}</Stamp>}
          {report && <span className="mono small">{report.red.length} red · {report.amber.length} amber</span>}
          {rec && <span className="mono small">{rec.carrier} · {gbp(rec.cost_gbp)}</span>}
        </div>
        <ol className="steps" aria-label="Progress" tabIndex={0}>
          {STEPS.map((t, i) => {
            const state = i < at ? "done" : i === at ? "now" : "todo"; // step i is done when `at` has passed it
            return (
              <li key={t} className={`step ${state}`} aria-current={state === "now" ? "step" : undefined}>
                <span className="step-dot" aria-hidden>{state === "done" ? "✓" : i + 1}</span>
                <span>{t}<span className="sr-only">{state === "done" ? " (done)" : state === "now" ? " (current)" : " (not started)"}</span></span>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { today, setToday, offline, setOffline, status, live, pill } = useSession();
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    if (!menu) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(false); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [menu]);

  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  return (
    <div className="site">
      <a className="skip" href="#main">Skip to content</a>
      <header className="topbar">
        <div className="wrap topbar-in">
          <Link className="brand" href="/"><span className="logo" aria-hidden />Shipment Pre-Flight</Link>
          <nav className="topnav" aria-label="Primary">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className={`navlink${active(n.href) ? " on" : ""}`} aria-current={active(n.href) ? "page" : undefined}>{n.label}</Link>
            ))}
          </nav>
          <span className="topright">
            <span className={`mode${live ? " live" : ""}`}><i />{pill}</span>
            <button className="btn small" onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-haspopup="dialog">Settings</button>
          </span>
        </div>
      </header>

      {menu && <div className="menu-veil" onClick={() => setMenu(false)} />}
      {menu && (
        <div className="settings" role="dialog" aria-label="Control Panel">
          <div className="sm-title">Control Panel</div>
          <label className="sm-check"><input type="checkbox" checked={offline} onChange={(e) => setOffline(e.target.checked)} /> Offline mode (keyless parser, no Gemini)</label>
          <label className="sm-row">Today&apos;s date (rule R-10)
            <input className="field" type="date" value={today} onChange={(e) => e.target.value && setToday(e.target.value)} />
          </label>
          <div className="sm-row small">Mode: {live && status ? status.label : offline ? "Offline parser (switched on)" : "Offline parser (no API key on server)"}</div>
          <div className="sm-row small">No login · nothing you enter is stored</div>
          <a className="btn" href="/samples/test_bookings_items.xlsx" download>Download sample workbook</a>
        </div>
      )}

      <TrackingHeader />
      <main id="main" tabIndex={-1}>{children}</main>

      <footer className="foot">
        <div className="wrap foot-in">
          <div><b className="brand-foot">Shipment Pre-Flight</b><p>UK → Germany · France · Netherlands · GBP only. No login. Nothing you enter is stored.</p></div>
          <div className="foot-links">
            {NAV.slice(1).map((n) => <Link key={n.href} href={n.href}>{n.label}</Link>)}
            <a href="/samples/test_bookings_items.xlsx" download>Sample workbook</a>
          </div>
        </div>
      </footer>

      <nav className="tabbar" aria-label="Primary (mobile)">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className={`tab${active(n.href) ? " on" : ""}`} aria-current={active(n.href) ? "page" : undefined}>
            <span className="tab-code" aria-hidden>{n.code}</span>{n.short}
          </Link>
        ))}
      </nav>
    </div>
  );
}
