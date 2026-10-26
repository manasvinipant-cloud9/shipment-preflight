"use client";
import { useState } from "react";

/**
 * Decorative crane-and-gate scene (design version A). Purely illustrative: the text on the containers is real
 * product vocabulary, but nothing here reads live data. Motion pauses on request and is off under reduced-motion (see CSS).
 */
export default function HeroScene() {
  const [paused, setPaused] = useState(false);
  return (
    <figure className={`hs${paused ? " paused" : ""}`}>
      <div className="hs-stage" aria-hidden>
        <div className="hs-gantry"><span>UK Gateway · Lane DE · FR · NL</span></div>
        <div className="hs-rail" /><div className="hs-trolley" />
        <div className="hs-lift"><div className="hs-rock">
          <svg className="hs-cables" width="300" height="140" viewBox="0 0 300 140" fill="none"><path d="M24 140 L150 0 M276 140 L150 0" /></svg>
          <div className="box rib-blue hs-booking">
            <b>BK-002</b><span className="hs-seller">Harbour Home Ltd</span><span className="hs-spec">London to Paris<br />2 pallets · 200 kg</span>
          </div>
        </div></div>
        <div className="hs-gate">
          <div className="hs-beam" />
          <span className="hs-gate-title">Pre-flight · 10 checks</span>
          <span className="hs-lamps"><i className="lr">RED</i><i className="la">AMBER</i><i className="lg">PASS</i></span>
        </div>
        <div className="hs-stack">
          <div className="box rib-red"><b>RED · BLOCKED</b><span>Fix required</span></div>
          <div className="box rib-amber"><b>AMBER · REVIEW</b><span>Warnings to check</span></div>
          <div className="box rib-green"><b>PASS · READY</b><span>Carrier recommended</span></div>
        </div>
      </div>
      <figcaption>
        <span>A booking is lowered to the gate, scanned, and lands as blocked, review or ready.</span>
        <button type="button" className="btn small" aria-pressed={paused} onClick={() => setPaused((p) => !p)}>{paused ? "Play animation" : "Pause animation"}</button>
      </figcaption>
    </figure>
  );
}
