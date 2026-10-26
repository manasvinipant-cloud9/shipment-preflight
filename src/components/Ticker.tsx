import { DEFAULT_RATE_CARD } from "@/lib/engine/carriers";

const CODE: Record<string, string> = { Germany: "DE", France: "FR", Netherlands: "NL" };

/** Rate board built from the real rate card: every service on every lane. Static and scrollable, no animation. */
export default function Ticker() {
  return (
    <div className="board" role="region" aria-label="Carrier rate board" tabIndex={0}>
      <span className="board-label">Freight ticker</span>
      <div className="board-track">
        {DEFAULT_RATE_CARD.map((l) => (
          <span className="tick" key={l.name + l.destination}>
            <b>{l.name}</b> {l.service} · UK→{CODE[l.destination]} · <em>£{l.price_per_pallet.toString()}/pallet</em> · {l.transit_days}d · {l.on_time_pct.toString()}% on time · max {l.max_pallet_kg.toString()} kg
          </span>
        ))}
      </div>
    </div>
  );
}
