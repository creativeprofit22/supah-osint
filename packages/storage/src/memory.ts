// Ring 3 (adapter): in-memory Store for tests. Follows the same rules as the SQLite adapter.
import {
  entityId,
  findingSlotKey,
  relationId,
  type Audit,
  type Entity,
  type Finding,
  type Relation,
} from "@supah-osint/core";
import type { Store } from "@supah-osint/engine";

const RESULTS: ReadonlySet<string> = new Set<Finding["result"]>(["found", "not_found", "inconclusive"]);

type StoredFinding = Omit<Finding, "entities" | "relations"> & { entityIds: string[]; relationIds: string[] };

export function createMemoryStore(): Store {
  const audits = new Map<string, Audit>();
  const entities = new Map<string, Entity>();
  const relations = new Map<string, Relation>();
  const findings = new Map<string, StoredFinding>();

  const requireAudit = (auditId: string) => {
    if (!audits.has(auditId)) throw new Error(`audit ${auditId} is not stored`);
  };

  // Checks a whole batch before writing anything, so each save is all-or-nothing.
  const plan = (newEntities: readonly Entity[], newRelations: readonly Relation[]) => {
    for (const entity of newEntities) requireAudit(entity.auditId);
    const known = new Set([...entities.keys(), ...newEntities.map(entityId)]);
    for (const relation of newRelations) {
      requireAudit(relation.auditId);
      for (const end of [relation.from, relation.to]) {
        if (!known.has(end)) throw new Error(`relation points to missing entity ${end}`);
      }
    }
    return () => {
      for (const entity of newEntities) {
        const id = entityId(entity);
        if (!entities.has(id)) entities.set(id, structuredClone(entity));
      }
      for (const relation of newRelations) {
        const id = relationId(relation);
        if (!relations.has(id)) relations.set(id, structuredClone(relation));
      }
    };
  };

  return {
    async saveAudit(audit) {
      audits.set(audit.id, { ...audit });
    },
    async getAudit(id) {
      const audit = audits.get(id);
      return audit ? { ...audit } : null;
    },
    async listAudits() {
      return [...audits.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((a) => ({ ...a }));
    },
    async saveEntities(batch) {
      plan(batch, [])();
    },
    async listEntities(auditId) {
      return [...entities.values()].filter((e) => e.auditId === auditId).map((e) => structuredClone(e));
    },
    async saveRelations(batch) {
      plan([], batch)();
    },
    async listRelations(auditId) {
      return [...relations.values()].filter((r) => r.auditId === auditId).map((r) => structuredClone(r));
    },
    async saveFindings(batch) {
      // Checked finding by finding, like SQLite's per-row foreign keys: a relation can't use a later finding's entity.
      const known = new Set(entities.keys());
      for (const finding of batch) {
        requireAudit(finding.auditId);
        if (!(finding.confidence >= 0 && finding.confidence <= 1)) {
          throw new Error(`finding confidence ${finding.confidence} is outside 0..1`);
        }
        if (!RESULTS.has(finding.result)) throw new Error(`finding result ${finding.result} is not allowed`);
        for (const entity of finding.entities) known.add(entityId(entity));
        for (const relation of finding.relations) {
          for (const end of [relation.from, relation.to]) {
            if (!known.has(end)) throw new Error(`relation points to missing entity ${end}`);
          }
        }
      }
      const write = plan(
        batch.flatMap((f) => f.entities),
        batch.flatMap((f) => f.relations),
      );
      write();
      for (const finding of batch) {
        const { entities: own, relations: edges, ...rest } = finding;
        findings.set(findingSlotKey(finding), {
          ...rest,
          entityIds: own.map(entityId),
          relationIds: edges.map(relationId),
        });
      }
    },
    async listFindings(auditId) {
      return [...findings.values()]
        .filter((f) => f.auditId === auditId)
        .map(({ entityIds, relationIds, ...rest }) => ({
          ...rest,
          entities: entityIds.map((id) => structuredClone(entities.get(id) as Entity)),
          relations: relationIds.map((id) => structuredClone(relations.get(id) as Relation)),
        }));
    },
  };
}
