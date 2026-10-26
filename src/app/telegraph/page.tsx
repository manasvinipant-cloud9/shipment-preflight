import type { Metadata } from "next";
import TelegraphPage from "@/components/pages/TelegraphPage";

export const metadata: Metadata = { title: "Telegraph · Shipment Pre-Flight" };

export default function Page() {
  return <TelegraphPage />;
}
