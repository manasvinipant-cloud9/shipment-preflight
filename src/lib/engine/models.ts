// Domain types. Everything is plain JSON so conversation state can round-trip through the browser
// (the API is stateless on Vercel). Decimal quantities are stored as strings and wrapped in Decimal at use.

export const DESTINATIONS = ["Germany", "France", "Netherlands"] as const;
export const DEST_TYPES = ["Warehouse", "Business address"] as const;
export const PRIORITIES = ["Cheapest", "Fastest", "Most reliable", "Balanced"] as const;

export type Severity = "Red" | "Amber"; // Red blocks booking; Amber warns

export interface Item {
  sku: string;
  description: string | null;
  hs_code: string | null;
  quantity: number | null;
  unit_price_gbp: string | null;
  units_per_carton: number | null;
  cartons: number | null;
  unit_weight_kg: string | null;
  country_of_origin: string | null;
}

export interface Shipment {
  destination_country: string | null;
  destination_type: string | null;
  delivery_appointment_booked: string | null; // "Yes" | "No" | null
  ready_date: string | null; // ISO YYYY-MM-DD
  pallets: number | null;
  total_cartons: number | null;
  total_gross_weight_kg: string | null;
  total_declared_value_gbp: string | null;
  priority: string | null;
  // Reference data from the booking form; never asked for in chat, shown in summaries.
  booking_id: string | null;
  seller_name: string | null;
  origin_city: string | null;
  origin_country: string | null;
  destination_city: string | null;
  items: Item[];
}

export interface Finding {
  rule_id: string;
  severity: Severity;
  title: string;
  detail: string; // what we saw, with the numbers
  fix: string; // what the seller should do
  field: string; // machine-readable pointer, e.g. "items[SKU1].hs_code"
}

export const newItem = (sku: string): Item => ({
  sku, description: null, hs_code: null, quantity: null, unit_price_gbp: null,
  units_per_carton: null, cartons: null, unit_weight_kg: null, country_of_origin: null,
});

export const newShipment = (): Shipment => ({
  destination_country: null, destination_type: null, delivery_appointment_booked: null, ready_date: null,
  pallets: null, total_cartons: null, total_gross_weight_kg: null, total_declared_value_gbp: null, priority: null,
  booking_id: null, seller_name: null, origin_city: null, origin_country: null, destination_city: null, items: [],
});
