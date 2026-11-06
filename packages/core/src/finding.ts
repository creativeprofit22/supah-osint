// What a source reported for one audit, including the entities and edges it produced.
import { entityId, mergeEntities, type AuditId, type Entity, type EntityId } from "./entities.ts";
import { err, ok, type Result } from "./normalize.ts";
import { isAllowedEdge, relationId, type Relation } from "./relations.ts";

// "inconclusive" means the source couldn't tell; it must never read as "not exposed".
export type FindingResult = "found" | "not_found" | "inconclusive";

export type Finding = {
  auditId: AuditId;
  source: string;
  url: string | null;
  foundAt: number;
  confidence: number;
  result: FindingResult;
  reason: string | null;
  entities: Entity[];
  relations: Relation[];
};

export function createFinding(input: Finding): Result<Finding> {
  if (input.auditId.trim() === "") return err("finding needs an auditId");
  if (input.source.trim() === "") return err("finding needs a source");
  if (!(input.confidence >= 0 && input.confidence <= 1)) return err("confidence must be between 0 and 1");
  if (input.result === "inconclusive" && !input.reason?.trim()) return err("an inconclusive finding needs a reason");
  if (input.result !== "found" && (input.entities.length > 0 || input.relations.length > 0)) {
    return err(`a ${input.result} finding cannot carry entities or relations`);
  }
  if (input.entities.some((entity) => entity.auditId !== input.auditId)) return err("entity belongs to another audit");
  if (input.relations.some((relation) => relation.auditId !== input.auditId))
    return err("relation belongs to another audit");
  const byId = new Map<EntityId, Entity>(input.entities.map((entity) => [entityId(entity), entity]));
  for (const relation of input.relations) {
    const from = byId.get(relation.from);
    const to = byId.get(relation.to);
    if (!from || !to) return err("relation points to an entity that is not in the finding");
    if (!isAllowedEdge(from.type, relation.label, to.type)) {
      return err(`edge not allowed: ${from.type} ${relation.label} ${to.type}`);
    }
  }
  return ok(input);
}

export function findingKey(finding: Finding): string {
  return `${finding.auditId}|${finding.source}|${finding.url ?? ""}|${finding.result}`;
}

// One slot per audit/source/url, whatever the result, so a rescan replaces the earlier answer.
export function findingSlotKey(finding: Finding): string {
  return `${finding.auditId}|${finding.source}|${finding.url ?? ""}`;
}

const RESULT_RANK: Record<FindingResult, number> = { not_found: 0, inconclusive: 1, found: 2 };

// One answer per slot within a scan, so the store's slot overwrite can't drop a real hit.
export function dedupeFindings(findings: readonly Finding[]): Finding[] {
  const seen = new Map<string, Finding>();
  for (const finding of findings) {
    const key = findingSlotKey(finding);
    const kept = seen.get(key);
    if (!kept || RESULT_RANK[finding.result] > RESULT_RANK[kept.result]) seen.set(key, finding);
    else if (finding.result === "found" && kept.result === "found") seen.set(key, mergeFound(kept, finding));
  }
  return [...seen.values()];
}

// Same key can hold several hits (e.g. url null); keep all their entities and edges.
function mergeFound(a: Finding, b: Finding): Finding {
  const relations = new Map<string, Relation>();
  for (const relation of [...a.relations, ...b.relations]) {
    const id = relationId(relation);
    if (!relations.has(id)) relations.set(id, relation);
  }
  return {
    ...a,
    confidence: Math.max(a.confidence, b.confidence),
    entities: mergeEntities([...a.entities, ...b.entities]),
    relations: [...relations.values()],
  };
}

export function mergeGraph(findings: readonly Finding[]): { entities: Entity[]; relations: Relation[] } {
  const found = findings.filter((finding) => finding.result === "found");
  const entities = mergeEntities(found.flatMap((finding) => finding.entities));
  const relations = new Map<string, Relation>();
  for (const relation of found.flatMap((finding) => finding.relations)) {
    const id = relationId(relation);
    if (!relations.has(id)) relations.set(id, relation);
  }
  return { entities, relations: [...relations.values()] };
}
