import { NextResponse } from "next/server";
import { SheetError, runBatch, toRow, type UploadedFile } from "@/lib/engine/sheets";
import { todayISO } from "@/lib/engine/util";

export const runtime = "nodejs";
export const maxDuration = 60;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MAX_FILES = 6;
const MAX_BYTES = 4 * 1024 * 1024; // Vercel functions accept bodies up to 4.5 MB

/** Batch check: upload the Bookings + Items workbook (or two CSVs). No LLM and no API key involved. */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Upload a .xlsx, .ods or .csv file." }, { status: 400 });
  }
  const entries = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!entries.length) return NextResponse.json({ error: "No file was uploaded." }, { status: 400 });
  if (entries.length > MAX_FILES) return NextResponse.json({ error: `Upload at most ${MAX_FILES} files.` }, { status: 400 });
  if (entries.some((f) => f.size > MAX_BYTES)) return NextResponse.json({ error: "That file is too large (4 MB limit)." }, { status: 400 });
  const t = form.get("today");
  const today = typeof t === "string" && ISO.test(t) ? t : todayISO();

  try {
    const files: UploadedFile[] = await Promise.all(entries.map(async (f) => ({ name: f.name, data: Buffer.from(await f.arrayBuffer()) })));
    const { results, fileNotes } = await runBatch(files, today);
    return NextResponse.json({ rows: results.map(toRow), fileNotes });
  } catch (e) {
    if (e instanceof SheetError) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: "Couldn't process that file. Check that it matches the template." }, { status: 500 });
  }
}
