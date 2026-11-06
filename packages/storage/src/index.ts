// Ring 3 (adapter): implements engine's Store.
import { findingSlotKey, type Finding } from "@supah-osint/core";
import type { Store } from "@supah-osint/engine";

export function createMemoryStore(): Store {
  const rows = new Map<string, Finding>();
  return {
    async saveFindings(findings) {
      for (const finding of findings) rows.set(findingSlotKey(finding), finding);
    },
    async listFindings(auditId) {
      return [...rows.values()].filter((finding) => finding.auditId === auditId);
    },
  };
}
