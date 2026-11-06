// Ring 2 (application): the interfaces the engine reaches the outside through.
import type { Audit, AuditId, Entity, Finding, Relation } from "@supah-osint/core";
import type { Http, Source } from "./source.ts";

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
  // Source id -> API key.
  keys?: Readonly<Record<string, string>>;
};
