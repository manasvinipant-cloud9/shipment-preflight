"use client";
import { useEffect, useState } from "react";
import ChatWindow from "./ChatWindow";
import FreightWindow from "./FreightWindow";
import Hero from "./Hero";
import LedgerWindow from "./LedgerWindow";
import ManifestWindow from "./ManifestWindow";
import { RateCardTable, RulebookTable } from "./RateRulebook";
import Ticker from "./Ticker";
import { Win, type Ctx } from "./ui";

type WinId = "chat" | "ledger" | "freight" | "manifest";

const WINS: Record<WinId, { title: string; sub: string; task: string }> = {
  chat: { title: "Telegraph", sub: "Conversational Intake", task: "Telegraph" },
  ledger: { title: "Ledger", sub: "Customs & Compliance · R-01 to R-10", task: "Ledger" },
  freight: { title: "Freight", sub: "Freight Ticker & Rate Matrix", task: "Rate matrix" },
  manifest: { title: "Manifest", sub: "Batch File Inspector", task: "Manifest" },
};

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

const pad = (n: number) => String(n).padStart(2, "0");
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

export default function App() {
  const [today, setToday] = useState("");
  const [offline, setOffline] = useState(false);
  const [status, setStatus] = useState<{ llm: boolean; label: string } | null>(null);
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [min, setMin] = useState<Record<WinId, boolean>>({ chat: false, ledger: false, freight: false, manifest: false });
  const [max, setMax] = useState<WinId | null>(null);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    setToday(localToday());
    fetch("/api/status").then((r) => r.json()).then(setStatus).catch(() => setStatus({ llm: false, label: "Offline parser (no API key)" }));
  }, []);

  useEffect(() => {
    if (!menu) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(false); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [menu]);

  const llm = !!status?.llm;
  const live = llm && !offline;
  const pill = offline ? "Offline parser" : status ? (llm ? status.label : "Offline parser · no key") : "Checking…";

  function focusWin(id: WinId) {
    setMax(null);
    setMin((m) => ({ ...m, [id]: false }));
    setTimeout(() => document.getElementById(`win-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
  }

  const win = (id: WinId, body: React.ReactNode) => (
    <Win id={id} title={WINS[id].title} sub={WINS[id].sub} minimized={min[id]} maximized={max === id}
      onMin={() => setMin((m) => ({ ...m, [id]: !m[id] }))} onMax={() => setMax((cur) => (cur === id ? null : id))}>
      {body}
    </Win>
  );

  return (
    <div className="site">
      <header className="topbar">
        <div className="wrap topbar-in">
          <a className="brand" href="#top"><span className="logo" aria-hidden />Shipment Pre-Flight</a>
          <nav className="topnav" aria-label="Workspace windows">
            {(Object.keys(WINS) as WinId[]).map((id) => (
              <button key={id} className={`navlink${min[id] ? " off" : ""}`} onClick={() => focusWin(id)}>{WINS[id].task}</button>
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
          <div className="sm-row small">Mode: {live ? status!.label : offline ? "Offline parser (switched on)" : "Offline parser (no API key on server)"}</div>
          <div className="sm-row small">No login · nothing you enter is stored</div>
          <a className="btn" href="/samples/test_bookings_items.xlsx" download>Download sample workbook</a>
        </div>
      )}

      <Hero />

      <section className="band muted" id="workspace">
        <div className="wrap">
          <h2>Workspace</h2>
          <p className="section-lead">Chat a booking, audit it against the rulebook, compare carriers, or inspect a batch file. The windows below stay in sync.</p>
          <Ticker />
          <main className={`desktop${max ? " has-max" : ""}`} data-max={max ?? ""}>
            {today && (
              <>
                {win("chat", <ChatWindow today={today} offline={offline} llm={llm} onContext={setCtx} />)}
                {win("ledger", <LedgerWindow ctx={ctx} />)}
                {win("freight", <FreightWindow ctx={ctx} />)}
                {win("manifest", <ManifestWindow today={today} onContext={setCtx} />)}
              </>
            )}
          </main>
        </div>
      </section>

      <section className="band dark">
        <div className="wrap">
          <h2>How it works</h2>
          <ol className="process">
            {STEPS.map((s, i) => (
              <li key={s.t}><span className="num">{i + 1}</span><h3>{s.t}</h3><p>{s.d}</p></li>
            ))}
          </ol>
          <div className="benefits">
            {BENEFITS.map((b) => <div key={b.t}><h3>{b.t}</h3><p>{b.d}</p></div>)}
          </div>
        </div>
      </section>

      <section className="band" id="rates">
        <div className="wrap narrow">
          <h2>Rate card and rulebook</h2>
          <p className="section-lead">Exactly what every booking is checked against.</p>
          <details className="disc"><summary>Rate card (Sheet 3)</summary><div className="disc-body"><RateCardTable /></div></details>
          <details className="disc"><summary>Rulebook (Sheet 4): R-01 to R-10</summary><div className="disc-body"><RulebookTable /></div></details>
        </div>
      </section>

      <footer className="band dark footer">
        <div className="wrap footer-in">
          <div><b className="brand-foot">Shipment Pre-Flight</b><p>UK → Germany · France · Netherlands · GBP only. No login. Nothing you enter is stored.</p></div>
          <div className="footer-links">
            <a href="#workspace">Workspace</a><a href="#rates">Rate card and rulebook</a>
            <a href="/samples/test_bookings_items.xlsx" download>Sample workbook</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
