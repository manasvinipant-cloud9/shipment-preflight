// Example inputs shown as one-click buttons. The structured ones work offline; the plain-English one needs Gemini.
import { addDays, fmtDMY } from "./engine/util";

export const DEMO_CHAT = `seller: Northfield Goods
origin city: Manchester
destination city: Frankfurt
country: Germany
type: Warehouse
appointment: No
ready date: 01-12-2026
pallets: 2
total cartons: 30
gross weight: 520
declared value: 6000
priority: Balanced
item A: desc=Cotton t-shirts, hs=610910, qty=1000, price=3, upc=50, cartons=20, weight=0.2, origin=India
item B: desc=Ceramic mugs, hs=691200, qty=500, price=6, upc=50, cartons=10, weight=0.4, origin=China
`;

/** A complete, correct booking. The ready date is relative to today so the demo never goes stale. */
export function exampleClean(today: string): string {
  return DEMO_CHAT.replace("appointment: No", "appointment: Yes").replace("01-12-2026", fmtDMY(addDays(today, 14)));
}

export function exampleNl(today: string): string {
  const [y, m, d] = addDays(today, 14).split("-").map(Number);
  const month = new Date(Date.UTC(y, m - 1, d)).toLocaleString("en-GB", { month: "long", timeZone: "UTC" });
  return "I need to send 2 pallets of ceramic mugs from Manchester to a warehouse in Frankfurt, ready on " +
    `${d} ${month} ${y}. 620 kg in total and 90 cartons. It's 1080 mugs (90 cartons of 12) at £5 each, ` +
    "0.5 kg each, HS code 691200, made in the UK. Declared value £5,400, appointment already booked. Balanced please.";
}

export const EXAMPLE_MISTAKES = `seller: Volt & Spark
origin city: London
destination city: Lyon
country: France
type: Business address
ready date: 01-10-2026
pallets: 1
total cartons: 12
gross weight: 700
declared value: 5000
priority: Cheapest
item A: desc=Li-ion portable power bank, hs=8507, qty=300, price=9, upc=30, cartons=10, weight=0.25, origin=China
item B: desc=Aerosol deodorant spray 150ml, hs=330720, qty=240, price=2.5, upc=24, cartons=10, weight=0.2, origin=United Kingdom
`;

export const SAMPLE_NOTES = [
  { booking: "BK-001", tests: "The template's own example: clean, Cheapest → Carrier A" },
  { booking: "BK-002", tests: "Clean, Balanced → Carrier B (date given as a real Excel date)" },
  { booking: "BK-003", tests: "R-01: one blank and one too-short HS code" },
  { booking: "BK-004", tests: "R-02: declared value 22% above quantity × price" },
  { booking: "BK-005", tests: "R-03 and R-04: carton arithmetic and carton total" },
  { booking: "BK-006", tests: "R-05: 650 kg per pallet is over the cheapest carrier's 500 kg limit; Carrier B can take it" },
  { booking: "BK-007", tests: "R-06: lithium power bank and aerosol" },
  { booking: "BK-008", tests: "R-07 (Amber): gross weight below the goods' own weight" },
  { booking: "BK-009", tests: "R-08, R-09, R-10 (all Amber): no appointment, missing origin, past date" },
  { booking: "BK-010", tests: "Seven rules at once; 800 kg per pallet so no carrier can take it" },
];
