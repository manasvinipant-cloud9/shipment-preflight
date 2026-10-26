// Batch input: the official test-data workbook -> one pre-flight report per booking.
//
// Expected structure (Case 2 template; judges upload Sheets 1 and 2 only):
//   Sheet "Bookings": title row, header row (Booking ID, Seller name, Origin city, ... Delivery appointment booked),
//                     then one row per shipment.
//   Sheet "Items":    title row, header row (Booking ID, SKU, Description, HS code, Quantity (units), Unit price, ...),
//                     then one row per product, linked by Booking ID.
//   Optional "Carrier options" sheet overrides the built-in rate card; "Rulebook" is informational (the ten rules are
//   implemented in code). Accepts one .xlsx/.xlsm/.ods workbook, or a pair of CSV files (bookings + items).
// The header row is found by content, so the template's title row and grey example row are handled; blank rows are skipped.
import { strFromU8, unzipSync } from "fflate";
import readXlsxFile from "read-excel-file/node";
import { DEFAULT_RATE_CARD, type Lane } from "./carriers";
import { Conversation, ITEM_SLOTS, SHIPMENT_SLOTS } from "./conversation";
import { dictToOps } from "./extractor";
import type { Shipment } from "./models";
import { preflight, type PreflightReport } from "./report";
import type { BatchRow } from "./export";
import { D, todayISO } from "./util";

export class SheetError extends Error {}

type Row = Record<string, unknown>;
type Grid = unknown[][];

export interface BookingResult {
  booking_id: string;
  shipment: Shipment;
  report: PreflightReport;
  notes: string[]; // data-quality notes: unreadable cells, missing required fields, orphan rows
}

const key = (h: unknown) => String(h ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const isBlank = (v: unknown) => v === null || v === undefined || (typeof v === "number" && Number.isNaN(v)) || String(v).trim() === "";

const BOOKING_COLS: Record<string, string> = {
  booking_id: "booking_id", seller_name: "seller_name", origin_city: "origin_city", origin_country: "origin_country",
  destination_city: "destination_city", destination_country: "destination_country", destination_type: "destination_type",
  ready_to_ship_date: "ready_date", seller_priority: "priority", pallets: "pallets", cartons: "total_cartons",
  total_declared_value: "total_declared_value_gbp", currency: "currency", total_gross_weight_kg: "total_gross_weight_kg",
  delivery_appointment_booked: "delivery_appointment_booked",
};
const ITEM_COLS: Record<string, string> = {
  booking_id: "booking_id", sku: "sku", description: "description", hs_code: "hs_code", quantity_units: "quantity",
  unit_price: "unit_price_gbp", units_per_carton: "units_per_carton", cartons: "cartons", unit_weight_kg: "unit_weight_kg",
  country_of_origin: "country_of_origin",
};
const CARRIER_COLS: Record<string, string> = {
  carrier: "name", service: "service", origin_country: "origin", destination_country: "destination",
  price_per_pallet: "price", transit_time_days: "days", on_time_rate: "ontime", max_weight_per_pallet_kg: "maxkg",
};

// ----------------------------------------------------------------------------------------- readers
/** Find the header row (first row containing `anchor`), map known columns, return one object per data row. */
function table(rows: Grid, cols: Record<string, string>, anchor: string, label: string): Row[] {
  const needsId = Object.values(cols).includes("booking_id");
  for (let i = 0; i < rows.length; i++) {
    const keys = rows[i].map(key);
    if (!keys.some((k) => k === anchor || k.startsWith(anchor))) continue;
    const header = keys.map((k) => cols[k] ?? cols[k.replace(/_(gbp|number|text)$/, "")] ?? null);
    if (needsId && !header.some(Boolean)) continue;
    const out: Row[] = [];
    for (const row of rows.slice(i + 1)) {
      const d: Row = {};
      header.forEach((h, j) => { if (h && !isBlank(row[j])) d[h] = row[j]; });
      if (Object.keys(d).length) out.push(d);
    }
    return out;
  }
  throw new SheetError(`Couldn't find the header row of the ${label} sheet (expected a '${anchor.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}' column).`);
}

function parseCsv(text: string): Grid {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = ""; rows.push(row); row = [];
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const decodeXml = (s: string) =>
  s.replace(/<text:s[^>]*\/>/g, " ").replace(/<text:tab\/>/g, "\t").replace(/<text:line-break\/>/g, "\n")
    .replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, "&");

const attr = (attrs: string, name: string) => new RegExp(`${name}="([^"]*)"`).exec(attrs)?.[1];

/** Minimal OpenDocument spreadsheet reader (the case template is distributed as .ods). */
function readOds(data: Uint8Array): Record<string, Grid> {
  const files = unzipSync(data);
  if (!files["content.xml"]) throw new SheetError("That .ods file has no content.");
  const xml = strFromU8(files["content.xml"]);
  const sheets: Record<string, Grid> = {};
  for (const t of xml.matchAll(/<table:table\b([^>]*)>([\s\S]*?)<\/table:table>/g)) {
    const name = decodeXml(attr(t[1], "table:name") ?? `Sheet${Object.keys(sheets).length + 1}`);
    const grid: Grid = [];
    for (const r of t[2].matchAll(/<table:table-row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:table-row>)/g)) {
      const cells: unknown[] = [];
      for (const c of (r[2] ?? "").matchAll(/<table:(?:table-cell|covered-table-cell)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:(?:table-cell|covered-table-cell)>)/g)) {
        const type = attr(c[1], "office:value-type");
        let v: unknown = null;
        if (type === "float" || type === "percentage" || type === "currency") v = Number(attr(c[1], "office:value"));
        else if (type === "date") v = attr(c[1], "office:date-value") ?? null;
        else if (type === "boolean") v = attr(c[1], "office:boolean-value") === "true";
        else if (type === "string") v = (c[2] ?? "").split("</text:p>").filter((p) => p.trim()).map(decodeXml).join("\n");
        const rep = Math.min(Number(attr(c[1], "table:number-columns-repeated") ?? 1), v === null ? 50 : 1000);
        for (let k = 0; k < rep; k++) cells.push(v);
      }
      const rowRep = Math.min(Number(attr(r[1], "table:number-rows-repeated") ?? 1), cells.every(isBlank) ? 1 : 1000);
      for (let k = 0; k < rowRep; k++) grid.push(cells);
    }
    sheets[name] = grid;
  }
  return sheets;
}

async function sheetGrids(name: string, data: Buffer): Promise<Record<string, Grid>> {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "xlsx" || ext === "xlsm") {
    try {
      const sheets = await readXlsxFile(data);
      return Object.fromEntries(sheets.map((s) => [s.sheet, s.data as Grid]));
    } catch {
      throw new SheetError(`Couldn't open ${name}. Is it a valid .xlsx file?`);
    }
  }
  if (ext === "ods") {
    try { return readOds(new Uint8Array(data)); } catch (e) {
      throw e instanceof SheetError ? e : new SheetError(`Couldn't open ${name}. Is it a valid .ods file?`);
    }
  }
  if (ext === "csv") return { [name]: parseCsv(data.toString("utf-8").replace(/^﻿/, "")) };
  throw new SheetError(`Unsupported file type '.${ext}'. Upload .xlsx, .ods, or two .csv files.`);
}

const findSheet = (sheets: Record<string, Grid>, ...words: string[]): Grid | null => {
  for (const [n, rows] of Object.entries(sheets)) if (words.some((w) => n.toLowerCase().includes(w))) return rows;
  return null;
};

export function loadRateCard(rows: Grid): Lane[] {
  const out: Lane[] = [];
  for (const d of table(rows, CARRIER_COLS, "carrier", "Carrier options")) {
    try {
      const num = (v: unknown) => { const x = D(String(v)); if (!x.isFinite()) throw new Error("nan"); return x; };
      out.push({
        name: String(d.name).trim(), service: String(d.service).trim(), origin: String(d.origin).trim(),
        destination: String(d.destination).trim(), price_per_pallet: num(d.price), transit_days: Math.trunc(Number(d.days)),
        on_time_pct: num(d.ontime), max_pallet_kg: num(d.maxkg),
      });
    } catch {
      throw new SheetError(`Carrier options sheet has an unreadable row: ${JSON.stringify(d)}`);
    }
  }
  if (!out.length) throw new SheetError("The Carrier options sheet has no rows.");
  return out;
}

export interface UploadedFile { name: string; data: Buffer }

export async function readWorkbook(files: UploadedFile[]): Promise<{ bookings: Row[]; items: Row[]; card: Lane[] | null }> {
  if (!files.length) throw new SheetError("No file provided.");
  const sheets: Record<string, Grid> = {};
  for (const f of files) Object.assign(sheets, await sheetGrids(f.name, f.data));
  let bRows = findSheet(sheets, "booking");
  let iRows = findSheet(sheets, "item");
  if (bRows === null || iRows === null) { // CSV pair: tell them apart by header content
    for (const rows of Object.values(sheets)) {
      const keys = new Set(rows.slice(0, 5).flatMap((r) => r.map(key)));
      if (keys.has("sku")) iRows = rows;
      else if (keys.has("seller_name") || keys.has("pallets")) bRows = rows;
    }
  }
  if (bRows === null) throw new SheetError("No 'Bookings' sheet found. Upload the template workbook, or a Bookings CSV and an Items CSV.");
  if (iRows === null) throw new SheetError("No 'Items' sheet found. Upload the template workbook, or a Bookings CSV and an Items CSV.");
  const cardRows = findSheet(sheets, "carrier");
  return {
    bookings: table(bRows, BOOKING_COLS, "booking_id", "Bookings"),
    items: table(iRows, ITEM_COLS, "booking_id", "Items"),
    card: cardRows ? loadRateCard(cardRows) : null,
  };
}

// ----------------------------------------------------------------------------------------- processing
function checkOne(bid: string, brow: Row, items: Row[], today: string, card: Lane[]): BookingResult {
  const notes: string[] = [];
  const { currency, ...data } = brow as Row & { currency?: unknown };
  const cur = String(currency ?? "GBP").trim().toUpperCase();
  if (cur !== "GBP") notes.push(`Currency is ${cur}; only GBP is supported, so values were read as GBP.`);
  data.origin_country = data.origin_country || "United Kingdom";
  data.items = items.map((i, n) => ({ ...i, sku: i.sku || `ITEM-${n + 1}` }));

  const conv = new Conversation(null, today);
  const { errors } = conv.applyPatch(dictToOps(data));
  const s = conv.shipment;
  for (const e of errors) notes.push(`Couldn't read a value: ${e}`);
  if (!s.items.length) notes.push("No items were found for this booking on the Items sheet.");
  if (!s.priority) {
    s.priority = "Balanced";
    notes.push("Seller priority is missing; assumed Balanced.");
  }
  for (const [f] of SHIPMENT_SLOTS) if ((s as unknown as Row)[f] === null && f !== "priority") notes.push(`Missing booking field: ${f}`);
  for (const it of s.items) // HS code and origin may legitimately be blank: rules R-01 / R-09 report them
    for (const [f] of ITEM_SLOTS) if ((it as unknown as Row)[f] === null) notes.push(`Missing for ${it.sku}: ${f}`);
  return { booking_id: bid, shipment: s, report: preflight(s, today, true, card, false), notes };
}

/** Check every booking. Returns results in file order plus file-level notes. */
export async function runBatch(
  files: UploadedFile[], today: string = todayISO(), card?: Lane[],
): Promise<{ results: BookingResult[]; fileNotes: string[] }> {
  const { bookings, items, card: override } = await readWorkbook(files);
  const rateCard = override ?? card ?? DEFAULT_RATE_CARD;
  const fileNotes = override ? ["Used the rate card from the uploaded 'Carrier options' sheet."] : [];
  const byId = new Map<string, Row[]>();
  for (const it of items) {
    const id = String(it.booking_id).trim();
    byId.set(id, [...(byId.get(id) ?? []), it]);
  }
  const results: BookingResult[] = [];
  const seen = new Set<string>();
  bookings.forEach((b, n) => {
    const bid = String(b.booking_id || `ROW-${n + 1}`).trim();
    if (seen.has(bid)) fileNotes.push(`Duplicate Booking ID ${bid}: every occurrence is checked separately.`);
    seen.add(bid);
    results.push(checkOne(bid, { ...b, booking_id: bid }, byId.get(bid) ?? [], today, rateCard));
  });
  const orphans = [...byId.keys()].filter((k) => !seen.has(k)).sort();
  if (orphans.length) fileNotes.push(`Items reference Booking IDs that are not on the Bookings sheet: ${orphans.join(", ")}.`);
  if (!results.length) throw new SheetError("The Bookings sheet has no data rows.");
  return { results, fileNotes };
}

/** The JSON shape the batch API returns and the browser renders / exports. */
export function toRow(r: BookingResult): BatchRow {
  const s = r.shipment;
  return {
    booking_id: r.booking_id, notes: r.notes, report: r.report, seller_name: s.seller_name, origin_city: s.origin_city,
    destination_city: s.destination_city, destination_country: s.destination_country, priority: s.priority,
  };
}
