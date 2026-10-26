"use client";
import { useEffect, useMemo, useState } from "react";
import { buildMatrix, type MatrixRow } from "@/lib/engine/carriers";
import { PRIORITIES } from "@/lib/engine/models";
import { Stamp, gbp, type Ctx, type StampKind } from "./ui";

const BADGE: Record<MatrixRow["status"], { kind: StampKind; text: string }> = {
  recommended: { kind: "green", text: "[RECOMMENDED]" },
  ranked: { kind: "grey", text: "[RANKED]" },
  "cost-capped": { kind: "amber", text: "[COST-CAPPED]" },
  "too-heavy": { kind: "red", text: "[TOO HEAVY]" },
};

export default function FreightWindow({ ctx }: { ctx: Ctx | null }) {
  const sellerPriority = ctx?.priority ?? "Balanced";
  const [priority, setPriority] = useState(sellerPriority);
  useEffect(() => { setPriority(sellerPriority); }, [sellerPriority, ctx?.label]);

  const matrix = useMemo(() => (ctx ? buildMatrix(ctx.shipment, priority) : null), [ctx, priority]);

  if (!ctx || !matrix) {
    return <div className="empty">NO LANE SELECTED.<br />Give the Telegraph a destination, or select an uploaded booking: every carrier on the lane is quoted, normalised and ranked here.</div>;
  }
  return (
    <div className="freight">
      <div className="freight-head">
        <span className="mono small">QUOTING: <b>{ctx.label}</b> · {ctx.shipment.destination_country ?? "no destination yet"} · {matrix.pallets} pallet{matrix.pallets === 1 ? "" : "s"}{ctx.shipment.pallets ? "" : " (assumed, none given yet)"}</span>
        <label className="mono small">SELLER PRIORITY&nbsp;
          <select className="field" value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Seller priority">
            {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
          </select>
        </label>
      </div>
      {priority !== sellerPriority && ctx.priority && <div className="notice">WHAT-IF: the seller actually chose <b>{ctx.priority}</b>.</div>}

      {matrix.rows.length === 0 ? <div className="empty">{matrix.justification}</div> : (
        <div className="cards">
          {matrix.rows.map((r) => {
            const b = BADGE[r.status];
            return (
              <article key={r.carrier + r.service} className={`ccard ${r.status}`}>
                <header>
                  <span className="rank mono">{r.rank ? `#${r.rank}` : "--"}</span>
                  <span className="cname">{r.carrier}</span><span className="csvc">{r.service}</span>
                  <Stamp kind={b.kind}>{b.text}</Stamp>
                </header>
                <div className="cstats">
                  <div><b>{gbp(r.cost_gbp)}</b><span>COST</span></div>
                  <div><b>{r.transit_days}d</b><span>TRANSIT</span></div>
                  <div><b>{r.on_time_pct}%</b><span>ON-TIME</span></div>
                  <div><b>{r.max_pallet_kg}kg</b><span>MAX/PALLET</span></div>
                  <div><b>{r.score ?? "--"}</b><span>SCORE</span></div>
                </div>
                {r.cost_ratio !== null && (
                  <div className="ratio" title="Rate ratio = best cost ÷ this cost. Ratios, not min-max, so one air-freight outlier can't distort the ranking.">
                    <span className="mono small">RATE RATIO {r.cost_ratio.toFixed(2)}</span>
                    <span className="meter"><i style={{ width: `${Math.round(r.cost_ratio * 100)}%` }} /></span>
                  </div>
                )}
                <div className="cnote mono small">{r.note}</div>
              </article>
            );
          })}
        </div>
      )}
      <div className="opnote"><b>OPERATOR NOTE:</b> {matrix.justification}</div>
    </div>
  );
}
