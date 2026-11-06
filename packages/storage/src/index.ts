// Ring 3 (adapter): implements engine's Store.
import { findingKey, type Finding } from "@supah-osint/core";
import type { Store } from "@supah-osint/engine";

export function createMemoryStore(): Store {
  const rows = new Map<string, Finding>();
  return {
    async saveFindings(findings) {
      for (const finding of findings) rows.set(findingKey(finding), finding);
    },
    async listFindings(subjectId) {
      return [...rows.values()].filter((finding) => finding.subjectId === subjectId);
    },
  };
}
