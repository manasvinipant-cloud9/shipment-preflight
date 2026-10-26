/** Opening: copy beside a still product diagram: the real inputs (chat, Sheets 1-4) converging on the pre-flight check. */
const TILES = [
  { x: 10, y: 34, w: 156, label: "Plain-English chat", sub: "Mode A" },
  { x: 294, y: 22, w: 156, label: "Bookings sheet", sub: "Sheet 1" },
  { x: 318, y: 178, w: 132, label: "Items sheet", sub: "Sheet 2" },
  { x: 250, y: 322, w: 150, label: "Rate card", sub: "Sheet 3" },
  { x: 36, y: 262, w: 140, label: "Rulebook", sub: "Sheet 4" },
];
const C = { x: 230, y: 196 };

function Diagram() {
  return (
    <svg className="diagram" viewBox="0 0 460 392" role="img" aria-labelledby="dg-t dg-d">
      <title id="dg-t">Inputs converging on the pre-flight check</title>
      <desc id="dg-d">A chat message and the Bookings, Items, Rate card and Rulebook sheets all feed one pre-flight check.</desc>
      <defs>
        <linearGradient id="core" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#3c78ff" /><stop offset="1" stopColor="#074ce0" /></linearGradient>
        <filter id="soft" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="#16191f" floodOpacity="0.12" /></filter>
      </defs>
      <circle cx={C.x} cy={C.y} r={104} fill="none" stroke="#dde0e6" />
      <circle cx={C.x} cy={C.y} r={168} fill="none" stroke="#e8eaef" />
      {TILES.map((t) => <line key={t.label} x1={t.x + t.w / 2} y1={t.y + 23} x2={C.x} y2={C.y} stroke="#c3c9d4" strokeWidth={1.5} />)}
      <circle cx={C.x} cy={C.y} r={62} fill="url(#core)" filter="url(#soft)" />
      <circle cx={C.x} cy={C.y} r={62} fill="none" stroke="#ffffff" strokeOpacity={0.35} />
      <text x={C.x} y={C.y - 4} textAnchor="middle" className="dg-core">Pre-flight</text>
      <text x={C.x} y={C.y + 16} textAnchor="middle" className="dg-core-sub">10 checks</text>
      {TILES.map((t) => (
        <g key={t.label} filter="url(#soft)">
          <rect x={t.x} y={t.y} width={t.w} height={46} rx={10} fill="#ffffff" stroke="#dde0e6" />
          <text x={t.x + 14} y={t.y + 20} className="dg-label">{t.label}</text>
          <text x={t.x + 14} y={t.y + 36} className="dg-sub">{t.sub}</text>
        </g>
      ))}
    </svg>
  );
}

const FACTS = [
  { v: "UK → DE · FR · NL", l: "Lanes" }, { v: "GBP", l: "Currency" }, { v: "10", l: "Automated checks" },
  { v: "Red / Amber", l: "Blocks / warns" }, { v: "No login", l: "Open to everyone" },
];

export default function Hero() {
  return (
    <section className="hero" id="top">
      <div className="wrap">
        <div className="hero-grid">
          <div className="hero-copy">
            <h1>Catch shipment mistakes <span>before</span> they leave the UK.</h1>
            <p className="lead">Describe a booking in plain English or upload a sheet. Ten automated customs and warehouse checks, the exact fix for each problem, and a carrier recommendation you can explain.</p>
            <div className="hero-actions">
              <a className="btn primary" href="#workspace">Start a booking</a>
              <a className="btn" href="#rates">See the rate card and rulebook</a>
            </div>
          </div>
          <Diagram />
        </div>
        <dl className="facts">
          {FACTS.map((f) => <div key={f.l}><dt>{f.l}</dt><dd>{f.v}</dd></div>)}
        </dl>
      </div>
    </section>
  );
}
