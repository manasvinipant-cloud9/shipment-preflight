// What the "Booking so far" panel shows. Built on the server (next to the conversation) and rendered by the browser.
import { SHIPMENT_SLOTS, type Conversation } from "./conversation";
import type { Finding, Shipment } from "./models";
import { fmtDMY, money, py } from "./util";

export interface BookingView {
  fields: { label: string; value: string | null }[];
  done: number;
  total: number;
  route: string | null;
  items: { sku: string; description: string; quantity: string; price: string; hs: string }[];
  live: Finding[];
}

const LABELS: Record<string, string> = {
  destination_country: "Destination country", destination_type: "Destination type", ready_date: "Ready to ship",
  pallets: "Pallets", total_gross_weight_kg: "Gross weight", total_cartons: "Total cartons",
  total_declared_value_gbp: "Declared value", priority: "Priority",
};

const FORMAT: Record<string, (v: string) => string> = {
  ready_date: fmtDMY,
  total_declared_value_gbp: (v) => `£${money(v)}`,
  total_gross_weight_kg: (v) => `${v} kg`,
};

export function buildView(conv: Conversation): BookingView {
  const s = conv.shipment as unknown as Record<string, unknown>;
  const sh: Shipment = conv.shipment;
  const fields = SHIPMENT_SLOTS.map(([f]) => {
    const v = s[f];
    return { label: LABELS[f as string], value: v === null || v === undefined ? null : (FORMAT[f as string] ?? String)(String(v)) };
  });
  return {
    fields,
    done: fields.filter((f) => f.value !== null).length,
    total: fields.length,
    route: sh.destination_city || sh.origin_city ? `${sh.origin_city || "UK"} → ${sh.destination_city || py(sh.destination_country)}` : null,
    items: sh.items.map((i) => ({
      sku: i.sku, description: i.description ?? "…", quantity: String(i.quantity ?? "?"),
      price: i.unit_price_gbp === null ? "?" : i.unit_price_gbp, hs: i.hs_code ?? "—",
    })),
    live: conv.liveFindings(),
  };
}
