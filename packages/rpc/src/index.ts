// Ring 3 (adapter): the only door from entry points into the app.
import type { Audit, AuditId, Finding } from "@supah-osint/core";
import { listFindings, runAudit, type EngineDeps } from "@supah-osint/engine";
import { openSqliteStore } from "@supah-osint/storage";

export { defaultDatabasePath } from "@supah-osint/storage";

export type Rpc = {
  search(audit: Audit): Promise<Finding[]>;
  findings(auditId: AuditId): Promise<Finding[]>;
};

export function createRpc(deps: EngineDeps): Rpc {
  return {
    search: async (audit) => (await runAudit(deps, { audit })).findings,
    findings: (auditId) => listFindings(deps, auditId),
  };
}

// Opens (and migrates) the database file; call close() when the app shuts down.
export function openStoredRpc(deps: Omit<EngineDeps, "store"> & { databasePath: string }): Rpc & { close(): void } {
  const { databasePath, ...rest } = deps;
  const store = openSqliteStore(databasePath);
  return { ...createRpc({ ...rest, store }), close: () => store.close() };
}
