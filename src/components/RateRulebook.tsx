import { DEFAULT_RATE_CARD } from "@/lib/engine/carriers";
import { RULEBOOK } from "@/lib/engine/rules";

/** Sheet 3 (rate card) exactly as the engine uses it. */
export function RateCardTable() {
  return (
    <div className="tbl-wrap"><table className="grid"><thead><tr><th>Carrier</th><th>Service</th><th>To</th><th>£/pallet</th><th>Days</th><th>On-time %</th><th>Max kg/pallet</th></tr></thead>
      <tbody>{DEFAULT_RATE_CARD.map((l) => <tr key={l.name + l.destination}><td>{l.name}</td><td>{l.service}</td><td>{l.destination}</td><td className="mono">{l.price_per_pallet.toString()}</td><td className="mono">{l.transit_days}</td><td className="mono">{l.on_time_pct.toString()}</td><td className="mono">{l.max_pallet_kg.toString()}</td></tr>)}</tbody></table></div>
  );
}

/** Sheet 4 (rulebook) exactly as the engine uses it. */
export function RulebookTable() {
  return (
    <div className="tbl-wrap"><table className="grid"><thead><tr><th>Rule</th><th>Check</th><th>If broken</th></tr></thead>
      <tbody>{RULEBOOK.map(([id, text, sev]) => <tr key={id}><td className="mono"><b>{id}</b></td><td>{text}</td><td>{sev}</td></tr>)}</tbody></table></div>
  );
}

export default function RateRulebook() {
  return <><RateCardTable /><RulebookTable /></>;
}
