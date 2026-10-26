import type { Metadata } from "next";
import ManifestPage from "@/components/pages/ManifestPage";

export const metadata: Metadata = { title: "Manifest inspector · Shipment Pre-Flight" };

export default function Page() {
  return <ManifestPage />;
}
