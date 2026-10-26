import { DEFAULT_RATE_CARD } from "@/lib/engine/carriers";

const CODE: Record<string, string> = { Germany: "DE", France: "FR", Netherlands: "NL" };

/** Scrolling rate board built from the real rate card: every service on every lane. */
export default function Ticker() {
  const items = DEFAULT_RATE_CARD.map((l) => (
    <span className="tick" key={l.name + l.destination}>
      <b>{l.name.toUpperCase()}</b> {l.service.toUpperCase()} UK→{CODE[l.destination]} <em>£{l.price_per_pallet.toString()}/PLT</em> {l.transit_days}D · {l.on_time_pct.toString()}% ON-TIME · MAX {l.max_pallet_kg.toString()}KG
    </span>
  ));
  return (
    <div className="ticker" role="marquee" aria-label="Carrier rate board">
      <span className="ticker-label">FREIGHT TICKER</span>
      <div className="ticker-track"><div className="ticker-move">{items}{items}</div></div>
    </div>
  );
}
