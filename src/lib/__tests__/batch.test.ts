// Batch mode: the official Bookings + Items workbook layout (template title row, header row, example row).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { confirmationsText, findingsCsv } from "../engine/export";
import { SheetError, runBatch, toRow, type UploadedFile } from "../engine/sheets";

const TODAY = "2026-10-25";
const fx = (f: string) => readFileSync(join(process.cwd(), "fixtures", f));
const XLSX: UploadedFile = { name: "t.xlsx", data: fx("test_bookings_items.xlsx") };

// rule ids each sample booking is expected to trigger (exact set)
const EXPECTED: Record<string, string[]> = {
  "BK-001": [], "BK-002": [], "BK-003": ["R-01"], "BK-004": ["R-02"], "BK-005": ["R-03", "R-04"], "BK-006": ["R-05"],
  "BK-007": ["R-06"], "BK-008": ["R-07"], "BK-009": ["R-08", "R-09", "R-10"], "BK-010": ["R-01", "R-02", "R-04", "R-05", "R-06", "R-08", "R-09"],
};

const B_HEAD = "Booking ID,Seller name,Origin city,Origin country,Destination city,Destination country,Destination type,Ready to ship date,Seller priority,Pallets,Cartons,Total declared value,Currency,Total gross weight (kg),Delivery appointment booked";
const I_HEAD = "Booking ID,SKU,Description,HS code,Quantity (units),Unit price,Units per carton,Cartons,Unit weight (kg),Country of origin";
const BK = "BK-X,Seller,Leeds,United Kingdom,Paris,France,Business address,10-11-2026,Balanced,1,10,100,GBP,60,No";
const IT = "BK-X,S1,Mug,691200,10,10,1,10,1,India";
const csv = (name: string, ...lines: string[]): UploadedFile => ({ name, data: Buffer.from(lines.join("\n")) });
const pair = (bookings: string[], items: string[]) => [csv("bookings.csv", B_HEAD, ...bookings), csv("items.csv", I_HEAD, ...items)];
const ruleIds = (r: { report: { red: { rule_id: string }[]; amber: { rule_id: string }[] } }) => [...r.report.red, ...r.report.amber].map((f) => f.rule_id);

describe("sample workbook (.xlsx)", () => {
  it("hits exactly the planted rules and has no data-quality notes", async () => {
    const { results, fileNotes } = await runBatch([XLSX], TODAY);
    expect(fileNotes).toEqual([]);
    expect(results).toHaveLength(10);
    for (const r of results) {
      expect([...new Set(ruleIds(r))].sort(), r.booking_id).toEqual(EXPECTED[r.booking_id]);
      expect(r.notes, r.booking_id).toEqual([]);
    }
  });

  it("recommendations follow priority and weight", async () => {
    const by = Object.fromEntries((await runBatch([XLSX], TODAY)).results.map((r) => [r.booking_id, r.report]));
    expect([by["BK-001"].recommended_carrier!.carrier, by["BK-001"].recommended_carrier!.cost_gbp]).toEqual(["Carrier A", 540]); // Cheapest, 3 x 180
    expect(by["BK-002"].recommended_carrier!.carrier).toBe("Carrier B"); // Balanced
    expect(by["BK-004"].recommended_carrier!.carrier).toBe("Carrier C"); // Fastest
    expect(by["BK-008"].recommended_carrier!.carrier).toBe("Carrier C"); // Most reliable
    expect(by["BK-006"].recommended_carrier!.carrier).toBe("Carrier B"); // 650 kg/pallet: A can't, B can
    expect(by["BK-006"].provisional).toBe(true);
    expect(by["BK-010"].recommended_carrier).toBeNull(); // 800 kg/pallet: nothing takes it
    expect(by["BK-001"].status).toBe("READY");
    expect(by["BK-008"].status).toBe("REVIEW");
  });

  it("reads template titles, Excel dates and numeric HS codes", async () => {
    const by = Object.fromEntries((await runBatch([XLSX], TODAY)).results.map((r) => [r.booking_id, r.shipment]));
    expect(by["BK-002"].ready_date).toBe("2026-11-09"); // a real Excel date cell
    expect(by["BK-001"].ready_date).toBe("2026-11-05"); // '05-11-2026' text, DD-MM-YYYY
    expect(by["BK-001"].items[0].hs_code).toBe("691200");
    expect(by["BK-002"].destination_type).toBe("Business address");
  });
});

describe("CSV pair", () => {
  it("matches the workbook", async () => {
    const a = (await runBatch([XLSX], TODAY)).results;
    const b = (await runBatch([{ name: "bookings.csv", data: fx("bookings.csv") }, { name: "items.csv", data: fx("items.csv") }], TODAY)).results;
    expect(b.map((r) => [r.booking_id, r.report.status])).toEqual(a.map((r) => [r.booking_id, r.report.status]));
  });

  it("reports data-quality notes", async () => {
    const bad = "BK-X,Seller,Leeds,United Kingdom,Paris,France,Business address,10-11-2026,,,10,100,USD,60,No";
    const { results, fileNotes } = await runBatch(pair([bad], [IT, "BK-ORPHAN" + IT.slice(4)]), TODAY);
    const n = results[0].notes.join(" ");
    expect(n).toContain("assumed Balanced");
    expect(n).toContain("USD");
    expect(n).toContain("pallets");
    expect(fileNotes.some((x) => x.includes("BK-ORPHAN"))).toBe(true);
    expect((await runBatch(pair([BK, BK], [IT]), TODAY)).fileNotes.some((x) => x.includes("Duplicate"))).toBe(true);
    expect((await runBatch(pair([BK], []), TODAY)).results[0].notes.some((x) => x.includes("No items"))).toBe(true);
  });

  it("allows blank HS code and origin but flags them", async () => {
    const it = "BK-X,S1,Mug,,10,10,1,10,1,";
    const r = (await runBatch(pair([BK], [it]), TODAY)).results[0];
    expect(ruleIds(r)).toEqual(expect.arrayContaining(["R-01", "R-09"]));
    expect(r.notes.some((n) => n.includes("hs_code") || n.includes("country_of_origin"))).toBe(false); // legitimately blank
  });

  it("handles quoted fields and a title row above the header", async () => {
    const items = csv("items.csv", "Items — one row per record.", I_HEAD, 'BK-X,S1,"Mug, ceramic ""large""",691200,10,10,1,10,1,India');
    const r = (await runBatch([csv("bookings.csv", "Bookings — title", B_HEAD, BK), items], TODAY)).results[0];
    expect(r.shipment.items[0].description).toBe('Mug, ceramic "large"');
  });

  it("uses a Carrier options sheet to override the rate card", async () => {
    const card = csv("carrier options.csv", "FIXED - judges will use exactly this rate card.",
      "Carrier,Service,Origin country,Destination country,Price per pallet,Currency,Transit time (days),On-time rate (%),Max weight per pallet (kg)",
      "Carrier Z,Road economy,United Kingdom,France,50,GBP,4,90,900");
    const { results, fileNotes } = await runBatch([...pair([BK], [IT]), card], TODAY);
    expect(results[0].report.recommended_carrier!.carrier).toBe("Carrier Z");
    expect(fileNotes.some((n) => n.includes("rate card"))).toBe(true);
  });
});

describe("OpenDocument (.ods)", () => {
  const cell = (v: string | number, kind: "s" | "f" | "d" = "s") =>
    kind === "f" ? `<table:table-cell office:value-type="float" office:value="${v}"><text:p>${v}</text:p></table:table-cell>`
      : kind === "d" ? `<table:table-cell office:value-type="date" office:date-value="${v}"><text:p>${v}</text:p></table:table-cell>`
        : `<table:table-cell office:value-type="string"><text:p>${String(v).replace(/&/g, "&amp;")}</text:p></table:table-cell>`;
  const row = (...cells: string[]) => `<table:table-row>${cells.join("")}</table:table-row>`;
  const sheet = (name: string, ...rows: string[]) => `<table:table table:name="${name}">${rows.join("")}</table:table>`;
  const ods = (...sheets: string[]) => ({
    name: "t.ods",
    data: Buffer.from(zipSync({
      mimetype: strToU8("application/vnd.oasis.opendocument.spreadsheet"),
      "content.xml": strToU8(`<?xml version="1.0"?><office:document-content xmlns:office="o" xmlns:table="t" xmlns:text="x"><office:body><office:spreadsheet>${sheets.join("")}</office:spreadsheet></office:body></office:document-content>`),
    })),
  });

  it("reads Bookings + Items + Carrier options like the template", async () => {
    const file = ods(
      sheet("Bookings", row(cell("Bookings — one row per record. Row 3 is an example")),
        row(...B_HEAD.split(",").map((h) => cell(h))),
        row(cell("BK-001"), cell("Northfield & Co"), cell("Manchester"), cell("United Kingdom"), cell("Frankfurt"), cell("Germany"), cell("Warehouse"),
          cell("2026-11-05", "d"), cell("Cheapest"), cell(3, "f"), cell(90, "f"), cell(5400, "f"), cell("GBP"), cell(620, "f"), cell("Yes")),
        `<table:table-row table:number-rows-repeated="1048000"><table:table-cell table:number-columns-repeated="1024"/></table:table-row>`),
      sheet("Items", row(cell("Items — title")), row(...I_HEAD.split(",").map((h) => cell(h))),
        row(cell("BK-001"), cell("MUG-01"), cell("Ceramic coffee mug, 350 ml"), cell(691200, "f"), cell(1080, "f"), cell(5, "f"), cell(12, "f"), cell(90, "f"), cell(0.5, "f"), cell("United Kingdom"))),
      sheet("Carrier options", row(cell("FIXED - judges will use exactly this rate card")),
        row(...["Carrier", "Service", "Origin country", "Destination country", "Price per pallet", "Currency", "Transit time (days)", "On-time rate (%)", "Max weight per pallet (kg)"].map((h) => cell(h))),
        row(cell("Carrier A"), cell("Road economy"), cell("United Kingdom"), cell("Germany"), cell(180, "f"), cell("GBP"), cell(5, "f"), cell(92, "f"), cell(500, "f"))),
      sheet("Rulebook", row(cell("FIXED")), row(cell("Rule ID"), cell("Rule"), cell("Severity if broken")), row(cell("R-01"), cell("HS"), cell("Red"))),
    );
    const { results, fileNotes } = await runBatch([file], TODAY);
    expect(results).toHaveLength(1);
    const r = results[0];
    expect(r.report.status).toBe("READY");
    expect(r.shipment.seller_name).toBe("Northfield & Co");
    expect(r.shipment.ready_date).toBe("2026-11-05");
    expect(r.shipment.items[0].hs_code).toBe("691200");
    expect(r.report.recommended_carrier).toMatchObject({ carrier: "Carrier A", cost_gbp: 540 });
    expect(fileNotes.some((n) => n.includes("rate card"))).toBe(true);
  });
});

describe("bad input and exports", () => {
  it("gives clear errors", async () => {
    for (const files of [[csv("x.txt", "hi")], [csv("x.csv", "a,b", "1,2")], [], [{ name: "x.xlsx", data: Buffer.from("not a zip") }]]) {
      await expect(runBatch(files as UploadedFile[], TODAY)).rejects.toBeInstanceOf(SheetError);
    }
    await expect(runBatch(pair([], [IT]), TODAY)).rejects.toThrow(/no data rows/);
  });

  it("exports findings CSV and confirmations", async () => {
    const rows = (await runBatch([XLSX], TODAY)).results.map(toRow);
    const text = findingsCsv(rows);
    expect(text.split("\n")[0]).toMatch(/^booking_id,seller,status/);
    expect(text).toContain("R-05");
    expect(text).toContain("BK-001");
    const conf = confirmationsText(rows);
    expect(conf).toContain("BK-006");
    expect(conf).toContain("What happens next");
    expect(conf).toContain("Why this carrier");
  });
});
