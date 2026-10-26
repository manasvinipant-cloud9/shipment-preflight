// Parity test: the TypeScript engine must reproduce, string for string, what the original Python engine produced
// (fixtures/golden.json was generated from it): every finding, carrier pick, justification and chat reply.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Conversation } from "../engine/conversation";
import { ruleBasedExtract } from "../engine/extractor";
import { runBatch } from "../engine/sheets";
import { EXAMPLE_MISTAKES } from "../examples";

const root = process.cwd();
const golden = JSON.parse(readFileSync(join(root, "fixtures/golden.json"), "utf8"));
const demo = readFileSync(join(root, "public/samples/demo_chat.txt"), "utf8");

describe("batch parity with the Python engine", () => {
  it("matches every booking: findings, carrier, justification, summary", async () => {
    const data = readFileSync(join(root, "fixtures/test_bookings_items.xlsx"));
    const { results, fileNotes } = await runBatch([{ name: "t.xlsx", data }], golden.today);
    expect(fileNotes).toEqual(golden.file_notes);
    expect(results).toHaveLength(golden.batch.length);
    results.forEach((r, i) => {
      const g = golden.batch[i];
      expect(r.booking_id).toBe(g.booking_id);
      expect(r.notes, r.booking_id).toEqual(g.notes);
      const rep = r.report;
      expect(rep.status, r.booking_id).toBe(g.report.status);
      expect(rep.red, r.booking_id).toEqual(g.report.red);
      expect(rep.amber, r.booking_id).toEqual(g.report.amber);
      expect(rep.recommended_carrier, r.booking_id).toEqual(g.report.recommended_carrier);
      expect(rep.alternatives, r.booking_id).toEqual(g.report.alternatives);
      expect(rep.provisional, r.booking_id).toBe(g.report.provisional);
      expect(rep.justification, r.booking_id).toBe(g.report.justification);
      expect(rep.summary, r.booking_id).toBe(g.report.summary);
    });
  });
});

async function run(turns: string[]) {
  const conv = new Conversation(ruleBasedExtract, golden.today);
  const out = [];
  for (const t of turns) {
    const reply = await conv.turn(t);
    out.push({
      input: t, reply, phase: conv.phase, status: conv.lastReport?.status ?? null, pallets: conv.shipment.pallets,
      stale: [...conv.stale].sort(), missing: conv.missing().slice(0, 3),
    });
  }
  return out;
}

describe("conversation parity with the Python engine", () => {
  const cases: Record<string, string[]> = {
    demo_flow: [demo, "add a pallet", "unchanged", "appointment: yes", "confirm"],
    mistakes: [EXAMPLE_MISTAKES],
    step_by_step: ["country: France", "Business", "2026-11-02", "4", "gross weight: 800"],
    declines: [
      "country: Germany\ntype: Warehouse\nready date: 05-11-2026\npallets: 2\ntotal cartons: 10\ngross weight: 300\ndeclared value: 500\npriority: Fastest\nitem A: desc=Mugs, qty=100, price=5, upc=10, cartons=10, weight=1",
      "unknown", "unknown", "skip",
    ],
  };
  for (const [name, turns] of Object.entries(cases)) {
    it(name, async () => {
      const got = await run(turns);
      const want = golden.conversations[name];
      expect(got).toHaveLength(want.length);
      got.forEach((g, i) => {
        expect(g.reply, `${name}[${i}] reply`).toBe(want[i].reply);
        expect({ ...g, reply: "", input: "" }, `${name}[${i}] state`).toEqual({ ...want[i], reply: "", input: "" });
      });
    });
  }
});
