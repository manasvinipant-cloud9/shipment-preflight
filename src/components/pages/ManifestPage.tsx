"use client";
import ManifestWindow from "../ManifestWindow";
import { useSession } from "../SessionProvider";
import { PageHead, Panel } from "../ui";

export default function ManifestPage() {
  const { today, setCtx } = useSession();
  return (
    <>
      <PageHead code="04" title="Manifest inspector" lead="Upload the Bookings and Items sheets. Every booking is checked against the rate card and the rulebook. Select one to open it in Customs and Freight." />
      <div className="wrap">
        <Panel title="Batch file inspector" sub="Bookings + Items, Rate card, Rulebook">
          {today && <ManifestWindow today={today} onContext={setCtx} />}
        </Panel>
      </div>
    </>
  );
}
