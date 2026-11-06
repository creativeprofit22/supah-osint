// Ring 2 (application): use cases. Talks to the outside only through the interfaces below.
import {
  createFinding,
  dedupeFindings,
  type Audit,
  type AuditId,
  type Entity,
  type Finding,
  type Relation,
} from "@supah-osint/core";

export type HttpResponse = { status: number; body: string };

export type Http = {
  get(url: string): Promise<HttpResponse>;
};

export type Source = {
  name: string;
  search(audit: Audit, http: Http): Promise<Finding[]>;
};

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
};

export async function runSearch(deps: EngineDeps, audit: Audit): Promise<Finding[]> {
  const results = await Promise.all(deps.sources.map((source) => source.search(audit, deps.http)));
  // Sources are untrusted: drop findings that break the Finding rules or belong to another audit.
  const valid = results.flat().filter((finding) => finding.auditId === audit.id && createFinding(finding).ok);
  const findings = dedupeFindings(valid);
  await deps.store.saveAudit(audit);
  await deps.store.saveFindings(findings);
  return findings;
}

export function listFindings(deps: Pick<EngineDeps, "store">, auditId: AuditId): Promise<Finding[]> {
  return deps.store.listFindings(auditId);
}
