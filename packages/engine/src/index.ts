// Ring 2 (application): use cases. Talks to the outside only through the interfaces in deps.ts and source.ts.
import type { AuditId, Finding } from "@supah-osint/core";
import type { EngineDeps } from "./deps.ts";

export * from "./deps.ts";
export * from "./source.ts";
export * from "./run-audit.ts";
export * from "./clock.ts";
export * from "./guard.ts";

export function listFindings(deps: Pick<EngineDeps, "store">, auditId: AuditId): Promise<Finding[]> {
  return deps.store.listFindings(auditId);
}
