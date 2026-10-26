"use client";
import Link from "next/link";
import FreightWindow from "../FreightWindow";
import { RateCardTable } from "../RateRulebook";
import { useSession } from "../SessionProvider";
import Ticker from "../Ticker";
import { PageHead, Panel } from "../ui";

export default function FreightPage() {
  const { ctx } = useSession();
  return (
    <>
      <PageHead code="03" title="Freight ticker and rate matrix" lead="Every carrier on the lane, normalised by rate ratio and ranked by the seller's priority. Change the priority to see a what-if." />
      <div className="wrap stack">
        <Ticker />
        <Panel title="Rate matrix" sub="Carrier matcher">
          <FreightWindow ctx={ctx} />
          {!ctx && (
            <div className="row-btns"><Link className="btn primary" href="/telegraph">Describe a booking</Link><Link className="btn" href="/manifest">Upload a batch</Link></div>
          )}
        </Panel>
        <Panel title="Rate card" sub="Sheet 3: UK to destination, GBP per pallet"><RateCardTable /></Panel>
      </div>
    </>
  );
}
