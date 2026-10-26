// Number and date helpers that reproduce the formatting of the original (Python Decimal) engine exactly.
import Decimal from "decimal.js";

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_EVEN }); // Python's default Decimal context

export { Decimal };
export const D = (v: Decimal.Value) => new Decimal(v);

const group = (s: string) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** Python f"{x:,.2f}" */
export function money(v: Decimal.Value, places = 2): string {
  const s = D(v).toFixed(places);
  const neg = s.startsWith("-");
  const [i, f] = (neg ? s.slice(1) : s).split(".");
  return (neg ? "-" : "") + group(i) + (f !== undefined ? "." + f : "");
}

/** Python f"{x:.0f}" / f"{x:.1f}" (no thousands separator) */
export const fixed = (v: Decimal.Value, places: number) => D(v).toFixed(places);

/** Python f"{x:g}" for the whole-number and short-decimal values used here */
export const g = (v: Decimal.Value) => D(v).toString();

/** Python str(None) == "None" in the original f-strings */
export const py = (v: unknown) => (v === null || v === undefined ? "None" : String(v));

// ---- dates: ISO "YYYY-MM-DD" strings everywhere ---------------------------------------------
const pad = (n: number, w = 2) => String(n).padStart(w, "0");

export function validIso(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

/** Tries the same formats as the original: DD-MM-YYYY, YYYY-MM-DD, DD/MM/YYYY, DD.MM.YYYY */
export function parseDate(text: string): string | null {
  const s = text.trim().slice(0, 10);
  let m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(s);
  if (m && validIso(+m[3], +m[2], +m[1])) return validIso(+m[3], +m[2], +m[1]);
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m && validIso(+m[1], +m[2], +m[3])) return validIso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m && validIso(+m[3], +m[2], +m[1])) return validIso(+m[3], +m[2], +m[1]);
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
  if (m && validIso(+m[3], +m[2], +m[1])) return validIso(+m[3], +m[2], +m[1]);
  return null;
}

export const isoFromDate = (d: Date) => `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return isoFromDate(new Date(Date.UTC(y, m - 1, d + days)));
}

export const fmtDMY = (iso: string | null) => (iso ? iso.split("-").reverse().join("-") : "?");

export const todayISO = () => isoFromDate(new Date());
