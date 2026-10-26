"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DEFAULT_RATE_CARD } from "@/lib/engine/carriers";
import type { BatchRow } from "@/lib/engine/export";
import { RULEBOOK } from "@/lib/engine/rules";
import HeroScene from "../HeroScene";
import { useSession, useSessionValue, type LaunchKind } from "../SessionProvider";
import { STATUS_STAMP, Stamp, gbp } from "../ui";
import Ticker from "../Ticker";

const LAUNCH: { k: LaunchKind; t: string; d: string }[] = [
  { k: "clean", t: "Clean booking", d: "Passes every check" },
  { k: "mistakes", t: "Booking with mistakes", d: "See what blocks it, and the fix" },
  { k: "change", t: "Change mid-chat", d: "Add a pallet, watch it re-price" },
];

const MODULES = [
  { href: "/telegraph", code: "01", t: "Telegraph", d: "Describe a shipment in plain English. Missing details are asked for, and every change is re-checked straight away.", cta: "Open chat" },
  { href: "/ledger", code: "02", t: "Customs ledger", d: "All ten rules audited live, Red first, each with the exact field and the fix.", cta: "Open ledger" },
  { href: "/freight", code: "03", t: "Freight matrix", d: "Every carrier on the lane, ratio-normalised and ranked by the seller's priority, with the reason in plain language.", cta: "Compare carriers" },
  { href: "/manifest", code: "04", t: "Manifest inspector", d: "Upload the Bookings and Items sheets. Every booking is checked, and any one can be opened line by line.", cta: "Upload a batch" },
];

const STEPS = [
  { t: "Describe or upload", d: "Type the shipment in plain English, or drop in the Bookings + Items sheet." },
  { t: "Pre-flight checks", d: "HS codes, values, cartons, pallet weight, dangerous goods, dates: 10 rules, every time." },
  { t: "Fix, then confirm", d: "Exact fixes, a carrier pick with the reason, and a confirmation the seller understands." },
];
const BENEFITS = [
  { t: "Exact fixes", d: "Every finding says what is wrong, how serious it is (Red blocks, Amber warns) and how to fix it." },
  { t: "Explainable carrier choice", d: "The recommendation comes with its reason, based on the seller's priority: Cheapest, Fastest, Most reliable or Balanced." },
  { t: "No login", d: "Open the link and start. Nothing you enter is stored." },
];

export default function Overview() {
  const router = useRouter();
  const { ctx, requestLaunch } = useSession();
  const rows = useSessionValue<BatchRow[] | null>("manifest.rows", null);
  const report = ctx?.report ?? null;
  const st = report ? STATUS_STAMP[report.status] : null;
  const rec = report?.recommended_carrier;
  const counts = { READY: 0, REVIEW: 0, BLOCKED: 0 };
  rows?.forEach((r) => { counts[r.report.status]++; });
  const red = RULEBOOK.filter((r) => r[2] === "Red").length;
  const carriers = new Set(DEFAULT_RATE_CARD.map((l) => l.name)).size;

  function launch(k: LaunchKind) { requestLaunch(k); router.push("/telegraph"); }

  return (
    <>
      <section className="yard">
        <div className="wrap yard-grid">
          <div className="yard-copy">
            <span className="stencil-tag">UK → DE · FR · NL</span>
            <h1>Catch shipment mistakes <span>before</span> they leave the UK.</h1>
            <p className="yard-lead">Describe a booking in plain English or upload a sheet. Ten automated customs and warehouse checks, the exact fix for each problem, and a carrier recommendation you can explain.</p>
            <div className="hero-actions">
              <Link className="btn hazard" href="/telegraph">Start a booking</Link>
              <Link className="btn ghost" href="/manifest">Upload a batch</Link>
            </div>
            <div className="launch-cards" role="group" aria-label="See a result in one click">
              <span className="label on-dark">Or see a result in one click</span>
              {LAUNCH.map((l) => (
                <button key={l.k} type="button" className="lcard" onClick={() => launch(l.k)}>
                  <b><span aria-hidden>▶</span> {l.t}</b><span>{l.d}</span>
                </button>
              ))}
            </div>
          </div>
          <HeroScene />
        </div>
      </section>

      <section className="wrap overview" aria-label="Live overview">
        <div className="kpis">
          <article className="kpi">
            <span className="label">Active booking</span>
            {ctx ? <b className="kpi-v">{ctx.label}</b> : <b className="kpi-v dim">None yet</b>}
            <span className="kpi-s">{st ? <Stamp kind={st.kind}>{st.text}</Stamp> : <Stamp kind="grey">{ctx ? "[DRAFT]" : "[IDLE]"}</Stamp>}</span>
          </article>
          <article className="kpi">
            <span className="label">Findings</span>
            <b className="kpi-v mono">{report ? `${report.red.length} red · ${report.amber.length} amber` : "—"}</b>
            <span className="kpi-s">{report ? "Red blocks, Amber warns" : "Runs when a booking is complete"}</span>
          </article>
          <article className="kpi">
            <span className="label">Recommended carrier</span>
            <b className="kpi-v">{rec ? `${rec.carrier}` : "—"}</b>
            <span className="kpi-s mono">{rec ? `${rec.service} · ${gbp(rec.cost_gbp)} · ${rec.transit_days}d` : "Chosen from the seller's priority"}</span>
          </article>
          <article className="kpi">
            <span className="label">Batch</span>
            <b className="kpi-v mono">{rows ? `${rows.length} bookings` : "—"}</b>
            <span className="kpi-s mono">{rows ? `${counts.READY} ready · ${counts.REVIEW} review · ${counts.BLOCKED} blocked` : "No file checked yet"}</span>
          </article>
        </div>
        <dl className="facts-strip">
          <div><dt>Lanes</dt><dd>3 · DE FR NL</dd></div>
          <div><dt>Currency</dt><dd>GBP</dd></div>
          <div><dt>Automated checks</dt><dd>{RULEBOOK.length}</dd></div>
          <div><dt>Red / Amber rules</dt><dd>{red} / {RULEBOOK.length - red}</dd></div>
          <div><dt>Carriers</dt><dd>{carriers}</dd></div>
        </dl>
        <Ticker />
      </section>

      <section className="wrap modules" aria-label="Tools">
        <h2 className="sec-title">Four tools, one booking</h2>
        <div className="mod-grid">
          {MODULES.map((m) => (
            <Link key={m.href} href={m.href} className="mod">
              <span className="mod-code" aria-hidden>{m.code}</span>
              <h3>{m.t}</h3>
              <p>{m.d}</p>
              <span className="mod-cta">{m.cta} <span aria-hidden>→</span></span>
            </Link>
          ))}
        </div>
      </section>

      <section className="steel">
        <div className="wrap">
          <h2 className="sec-title on-dark">How it works</h2>
          <ol className="process">
            {STEPS.map((s, i) => (<li key={s.t}><span className="num">{i + 1}</span><h3>{s.t}</h3><p>{s.d}</p></li>))}
          </ol>
          <div className="benefits">
            {BENEFITS.map((b) => <div key={b.t}><h3>{b.t}</h3><p>{b.d}</p></div>)}
          </div>
        </div>
      </section>
    </>
  );
}
