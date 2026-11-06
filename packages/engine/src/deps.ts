// Ring 2 (application): the interfaces the engine reaches the outside through.
import type { Audit, AuditId, Entity, Finding, Relation } from "@supah-osint/core";
import type { Http, Source } from "./source.ts";
import type { SourceGuard } from "./guard.ts";

// Every save is all-or-nothing and rejects if its audit (or a relation's entity) isn't stored.
// Entities and relations merge on entityId / relationId, keeping the first-seen props.
// Findings replace by findingSlotKey and also save their entities and relations.
// Lists return insertion order, except listAudits, which is ordered by id.
export type Store = {
  saveAudit(audit: Audit): Promise<void>;
  getAudit(id: AuditId): Promise<Audit | null>;
  listAudits(): Promise<Audit[]>;
  saveEntities(entities: readonly Entity[]): Promise<void>;
  listEntities(auditId: AuditId): Promise<Entity[]>;
  saveRelations(relations: readonly Relation[]): Promise<void>;
  listRelations(auditId: AuditId): Promise<Relation[]>;
  saveFindings(findings: readonly Finding[]): Promise<void>;
  listFindings(auditId: AuditId): Promise<Finding[]>;
};

export type EngineDeps = {
  sources: readonly Source[];
  store: Store;
  http: Http;
  keys?: KeySource;
  // Long-lived so parking and key rotation carry across audits; runAudit makes one per run if missing.
  guard?: SourceGuard;
};

// Where API keys come from (OS keychain in the app). A source may have several keys to rotate through.
export type KeySource = {
  list(sourceId: string): Promise<readonly string[]>;
};

export function staticKeys(record: Readonly<Record<string, readonly string[]>>): KeySource {
  return { list: async (sourceId) => record[sourceId] ?? [] };
}
