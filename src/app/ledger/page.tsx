import type { Metadata } from "next";
import LedgerPage from "@/components/pages/LedgerPage";

export const metadata: Metadata = { title: "Customs ledger · Shipment Pre-Flight" };

export default function Page() {
  return <LedgerPage />;
}
