// Maps findings onto the ten-rule rulebook so every rule shows a status, not just the ones that failed.
import type { Finding } from "./models";
import { RULEBOOK } from "./rules";

export type Stamp = "RED" | "AMBER" | "PASS" | "PENDING";

export interface LedgerRow {
  id: string;
  rule: string;
  severity: "Red" | "Amber";
  stamp: Stamp;
  findings: Finding[];
}

/**
 * `complete` = a full pre-flight ran (chat finished, or an uploaded booking): rules without findings PASS.
 * Otherwise (a draft still being collected) they stay PENDING: absence of a finding isn't a pass yet.
 */
export function ledgerRows(findings: Finding[], complete: boolean): LedgerRow[] {
  return RULEBOOK.map(([id, rule, severity]) => {
    const hits = findings.filter((f) => f.rule_id === id);
    const stamp: Stamp = hits.length ? (severity === "Red" ? "RED" : "AMBER") : complete ? "PASS" : "PENDING";
    return { id, rule, severity, stamp, findings: hits };
  });
}
