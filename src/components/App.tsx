"use client";
import { useEffect, useState } from "react";
import ChatWindow from "./ChatWindow";
import FreightWindow from "./FreightWindow";
import LedgerWindow from "./LedgerWindow";
import ManifestWindow from "./ManifestWindow";
import Ticker from "./Ticker";
import { Win, type Ctx } from "./ui";

type WinId = "chat" | "ledger" | "freight" | "manifest";

const WINS: Record<WinId, { title: string; sub: string; task: string }> = {
  chat: { title: "TELEGRAPH.EXE", sub: "Conversational Intake", task: "Telegraph" },
  ledger: { title: "LEDGER.EXE", sub: "Customs & Compliance · R-01 to R-10", task: "Ledger" },
  freight: { title: "FREIGHT.EXE", sub: "Freight Ticker & Rate Matrix", task: "Rate Matrix" },
  manifest: { title: "MANIFEST.EXE", sub: "Batch File Inspector", task: "Manifest" },
};

const pad = (n: number) => String(n).padStart(2, "0");
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const localClock = () => new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

export default function App() {
  const [today, setToday] = useState("");
  const [clock, setClock] = useState("");
  const [offline, setOffline] = useState(false);
  const [status, setStatus] = useState<{ llm: boolean; label: string } | null>(null);
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [min, setMin] = useState<Record<WinId, boolean>>({ chat: false, ledger: false, freight: false, manifest: false });
  const [max, setMax] = useState<WinId | null>(null);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    setToday(localToday());
    setClock(localClock());
    const t = setInterval(() => setClock(localClock()), 20_000);
    fetch("/api/status").then((r) => r.json()).then(setStatus).catch(() => setStatus({ llm: false, label: "Offline parser (no API key)" }));
    return () => clearInterval(t);
  }, []);

  const llm = !!status?.llm;
  const live = llm && !offline;
  const pill = offline ? "OFFLINE PARSER" : status ? (llm ? status.label.toUpperCase() : "OFFLINE PARSER · NO KEY") : "CHECKING…";

  function focusWin(id: WinId) {
    setMax(null);
    setMin((m) => ({ ...m, [id]: false }));
    setTimeout(() => document.getElementById(`win-${id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 30);
  }

  const win = (id: WinId, body: React.ReactNode) => (
    <Win id={id} title={WINS[id].title} sub={WINS[id].sub} minimized={min[id]} maximized={max === id}
      onMin={() => setMin((m) => ({ ...m, [id]: !m[id] }))} onMax={() => setMax((cur) => (cur === id ? null : id))}>
      {body}
    </Win>
  );

  return (
    <div className="os">
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

      {menu && <div className="menu-veil" onClick={() => setMenu(false)} />}
      {menu && (
        <div className="startmenu" role="dialog" aria-label="Control Panel">
          <div className="sm-title">CONTROL PANEL</div>
          <label className="sm-row"><input type="checkbox" checked={offline} onChange={(e) => setOffline(e.target.checked)} /> Offline mode (keyless parser, no Gemini)</label>
          <label className="sm-row">Today&apos;s date (rule R-10)
            <input className="field" type="date" value={today} onChange={(e) => e.target.value && setToday(e.target.value)} />
          </label>
          <div className="sm-row mono small">MODE: {live ? status!.label : offline ? "Offline parser (switched on)" : "Offline parser (no API key on server)"}</div>
          <div className="sm-row mono small">No login · nothing you enter is stored</div>
          <a className="btn" href="/samples/test_bookings_items.xlsx" download>Download sample workbook</a>
        </div>
      )}

      <footer className="taskbar">
        <button className={`btn start${menu ? " on" : ""}`} onClick={() => setMenu((m) => !m)} aria-expanded={menu}>◢ START</button>
        <span className="tasks">
          {(Object.keys(WINS) as WinId[]).map((id) => (
            <button key={id} className={`btn task${min[id] ? "" : " on"}`} onClick={() => focusWin(id)} title={min[id] ? "Restore" : "Show"}>{WINS[id].task}</button>
          ))}
        </span>
        <span className="tray">
          <span className={`mode${live ? " live" : ""}`}><i />{pill}</span>
          <span className="clock mono">{clock}</span>
        </span>
      </footer>
    </div>
  );
}
