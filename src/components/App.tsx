"use client";
import { useEffect, useState } from "react";
import BatchTab from "./BatchTab";
import ChatTab from "./ChatTab";

const pad = (n: number) => String(n).padStart(2, "0");
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

function Route() {
  const node = (x: number, y: number, name: string) => (
    <g key={name}><circle cx={x} cy={y} r={16} fill="#38bdf8" /><text x={x} y={y + 4} textAnchor="middle" fontSize={11} fontWeight={800} fill="#07142b">{name}</text></g>
  );
  return (
    <svg className="route" viewBox="0 0 380 190" role="img" aria-label="UK to the Netherlands, Germany and France">
      <path className="l" d="M84 98 C150 98 200 36 290 34" /><path className="l" d="M84 98 C170 98 240 98 310 98" /><path className="l" d="M84 98 C150 98 200 160 286 160" />
      <circle cx={62} cy={98} r={24} fill="#fbbf24" /><text x={62} y={103} textAnchor="middle" fontSize={14} fontWeight={800} fill="#07142b">UK</text>
      {node(306, 34, "NL")}{node(326, 98, "DE")}{node(302, 160, "FR")}
    </svg>
  );
}

export default function App() {
  const [tab, setTab] = useState<"chat" | "batch">("chat");
  const [today, setToday] = useState("");
  const [offline, setOffline] = useState(false);
  const [status, setStatus] = useState<{ llm: boolean; label: string } | null>(null);

  useEffect(() => {
    setToday(localToday());
    fetch("/api/status").then((r) => r.json()).then(setStatus).catch(() => setStatus({ llm: false, label: "Offline parser (no API key)" }));
  }, []);

  const llm = !!status?.llm;
  const pill = offline ? "Offline parser · switched on" : status ? (llm ? status.label : "Offline parser · no API key") : "Checking…";

  return (
    <main className="container">
      <div className="hero">
        <div className="hero-top">
          <span className="brand">SHIPMENT PRE-FLIGHT</span>
          <span className="hero-right">
            <label className="toggle" title="Use the keyless parser even if Gemini is configured (handy if the API is slow)">
              <input type="checkbox" checked={offline} onChange={(e) => setOffline(e.target.checked)} /> Offline mode
            </label>
            <span className={`mode ${llm && !offline ? "on" : ""}`}><i />{pill}</span>
          </span>
        </div>
        <div className="hero-main">
          <div className="hero-copy">
            <h1>Catch shipment mistakes <em>before</em> they leave the UK.</h1>
            <p>Describe a booking in plain English or upload a sheet. Ten automated customs and warehouse checks, the exact fix for each problem, and a carrier recommendation you can explain.</p>
            <div className="chips">
              <span className="chip">UK → Germany · France · Netherlands</span><span className="chip">GBP</span>
              <span className="chip">10 rules · Red blocks, Amber warns</span><span className="chip">No login</span>
            </div>
          </div>
          <Route />
        </div>
      </div>

      <div className="steps">
        <div className="step"><div className="n">1</div><div><b>Describe or upload</b><span>Type the shipment in plain English, or drop in the Bookings + Items sheet.</span></div></div>
        <div className="step"><div className="n">2</div><div><b>Pre-flight checks</b><span>HS codes, values, cartons, pallet weight, dangerous goods, dates: 10 rules, every time.</span></div></div>
        <div className="step"><div className="n">3</div><div><b>Fix, then confirm</b><span>Exact fixes, a carrier pick with the reason, and a confirmation the seller understands.</span></div></div>
      </div>

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "chat"} className={`tab ${tab === "chat" ? "active" : ""}`} onClick={() => setTab("chat")}>💬  Chat booking</button>
        <button role="tab" aria-selected={tab === "batch"} className={`tab ${tab === "batch" ? "active" : ""}`} onClick={() => setTab("batch")}>📄  Batch upload (Excel / CSV)</button>
      </div>

      {today && (
        <>
          <div hidden={tab !== "chat"}><ChatTab today={today} offline={offline} llm={llm} /></div>
          <div hidden={tab !== "batch"}><BatchTab today={today} /></div>
        </>
      )}

      <div className="footer">
        <span>No login. Nothing you enter is stored.</span>
        <label>Today&apos;s date (used by rule R-10)
          <input type="date" value={today} onChange={(e) => e.target.value && setToday(e.target.value)} />
        </label>
      </div>
    </main>
  );
}
