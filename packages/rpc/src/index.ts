// Ring 3 (adapter): the only door from entry points into the app.
import type { Audit, AuditId, Finding } from "@supah-osint/core";
import {
  createSourceGuard,
  listFindings,
  runAudit,
  systemClock,
  type EngineDeps,
  type KeySource,
  type SourceHealth,
} from "@supah-osint/engine";
import { createKeychainKeys } from "@supah-osint/keychain";
import { openSqliteStore } from "@supah-osint/storage";

export { defaultDatabasePath } from "@supah-osint/storage";
export type { SourceHealth } from "@supah-osint/engine";

export type WritableKeys = KeySource & { set(sourceId: string, keys: readonly string[]): Promise<void> };

export type Rpc = {
  search(audit: Audit): Promise<Finding[]>;
  findings(auditId: AuditId): Promise<Finding[]>;
  sourceHealth(): SourceHealth[];
  reviveSource(sourceId: string): void;
  setSourceKeys(sourceId: string, keys: readonly string[]): Promise<void>;
};

export function createRpc(deps: Omit<EngineDeps, "keys"> & { keys?: KeySource | WritableKeys }): Rpc {
  // One guard for the app's lifetime, so parked sources and key rotation carry across audits.
  const guard = deps.guard ?? createSourceGuard({ clock: systemClock });
  const engine: EngineDeps = { ...deps, guard };
  return {
    search: async (audit) => (await runAudit(engine, { audit })).findings,
    findings: (auditId) => listFindings(engine, auditId),
    sourceHealth: () => guard.health(),
    reviveSource: (sourceId) => guard.revive(sourceId),
    setSourceKeys: async (sourceId, keys) => {
      const store = deps.keys;
      if (!store || !("set" in store)) throw new Error("this key store is read-only");
      await store.set(sourceId, keys);
      // A source parked for a bad key should get a fresh try with the new one.
      guard.revive(sourceId);
    },
  };
}

// Opens (and migrates) the database file; call close() when the app shuts down.
export function openStoredRpc(
  deps: Omit<EngineDeps, "store" | "keys"> & { databasePath: string; keys?: KeySource | WritableKeys },
): Rpc & { close(): void } {
  const { databasePath, ...rest } = deps;
  const store = openSqliteStore(databasePath);
  return { ...createRpc({ ...rest, keys: rest.keys ?? createKeychainKeys(), store }), close: () => store.close() };
}
