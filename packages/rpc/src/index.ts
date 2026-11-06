// Ring 3 (adapter): the only door from entry points into the app.
import type { Audit, AuditId, Finding } from "@supah-osint/core";
import { listFindings, runSearch, type EngineDeps } from "@supah-osint/engine";
import { createMemoryStore } from "@supah-osint/storage";

export type Rpc = {
  search(audit: Audit): Promise<Finding[]>;
  findings(auditId: AuditId): Promise<Finding[]>;
};

export function createRpc(deps: EngineDeps): Rpc {
  return {
    search: (audit) => runSearch(deps, audit),
    findings: (auditId) => listFindings(deps, auditId),
  };
}

export function createLocalRpc(deps: Omit<EngineDeps, "store">): Rpc {
  return createRpc({ ...deps, store: createMemoryStore() });
}
