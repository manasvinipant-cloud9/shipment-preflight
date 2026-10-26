import type { Metadata } from "next";
import FreightPage from "@/components/pages/FreightPage";

export const metadata: Metadata = { title: "Freight matrix · Shipment Pre-Flight" };

export default function Page() {
  return <FreightPage />;
}
