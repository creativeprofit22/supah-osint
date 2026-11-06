// Ring 3 (adapter): the engine's Store on bun:sqlite. The only module that touches the database.
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  entityId,
  findingSlotKey,
  relationId,
  type Audit,
  type Entity,
  type EntityId,
  type Finding,
  type Relation,
} from "@supah-osint/core";
import type { Store } from "@supah-osint/engine";
import { migrate } from "./migrations.ts";

export type SqliteStore = Store & { close(): void };

type AuditRow = { id: string; subject_name: string };
type EntityRow = { audit_id: string; type: Entity["type"]; key: string; props: string };
type RelationRow = { audit_id: string; label: Relation["label"]; from_id: string; to_id: string };
type FindingRow = {
  audit_id: string;
  source: string;
  url: string | null;
  found_at: number;
  confidence: number;
  result: Finding["result"];
  reason: string | null;
  entity_ids: string;
  relation_ids: string;
};

const toAudit = (row: AuditRow): Audit => ({ id: row.id, subjectName: row.subject_name });
const toEntity = (row: EntityRow): Entity =>
  ({ auditId: row.audit_id, type: row.type, key: row.key, props: JSON.parse(row.props) }) as Entity;
const toRelation = (row: RelationRow): Relation => ({
  auditId: row.audit_id,
  label: row.label,
  from: row.from_id,
  to: row.to_id,
});

export function openSqliteStore(path: string): SqliteStore {
  const inMemory = path === ":memory:" || path === "";
  if (!inMemory) mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, readwrite: true });
  try {
    db.run("PRAGMA busy_timeout = 5000");
    db.run("PRAGMA foreign_keys = ON");
    // Before any other write, so a file from a newer app is left exactly as it was.
    migrate(db);
    if (!inMemory) db.run("PRAGMA journal_mode = WAL");
  } catch (error) {
    db.close();
    throw error;
  }

  const upsertAudit = db.query<void, [string, string]>(
    "INSERT INTO audits (id, subject_name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET subject_name = excluded.subject_name",
  );
  const insertEntity = db.query<void, [string, string, string, string, string]>(
    "INSERT INTO entities (id, audit_id, type, key, props) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
  );
  const insertRelation = db.query<void, [string, string, string, string, string]>(
    "INSERT INTO relations (id, audit_id, label, from_id, to_id) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
  );
  // Upsert keeps the slot's rowid, so a rescan keeps its place in the list.
  const upsertFinding = db.query<
    void,
    [string, string, string, string | null, number, number, string, string | null, string, string]
  >(
    `INSERT INTO findings (slot, audit_id, source, url, found_at, confidence, result, reason, entity_ids, relation_ids)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(slot) DO UPDATE SET
       audit_id = excluded.audit_id, source = excluded.source, url = excluded.url, found_at = excluded.found_at,
       confidence = excluded.confidence, result = excluded.result, reason = excluded.reason,
       entity_ids = excluded.entity_ids, relation_ids = excluded.relation_ids`,
  );
  const selectAudit = db.query<AuditRow, [string]>("SELECT id, subject_name FROM audits WHERE id = ?");
  const selectAudits = db.query<AuditRow, []>("SELECT id, subject_name FROM audits ORDER BY id");
  const selectEntities = db.query<EntityRow, [string]>(
    "SELECT audit_id, type, key, props FROM entities WHERE audit_id = ? ORDER BY rowid",
  );
  const selectEntity = db.query<EntityRow, [string]>("SELECT audit_id, type, key, props FROM entities WHERE id = ?");
  const selectRelations = db.query<RelationRow, [string]>(
    "SELECT audit_id, label, from_id, to_id FROM relations WHERE audit_id = ? ORDER BY rowid",
  );
  const selectRelation = db.query<RelationRow, [string]>(
    "SELECT audit_id, label, from_id, to_id FROM relations WHERE id = ?",
  );
  const selectFindings = db.query<FindingRow, [string]>(
    `SELECT audit_id, source, url, found_at, confidence, result, reason, entity_ids, relation_ids
     FROM findings WHERE audit_id = ? ORDER BY rowid`,
  );

  const writeEntities = (entities: readonly Entity[]) => {
    for (const entity of entities) {
      insertEntity.run(entityId(entity), entity.auditId, entity.type, entity.key, JSON.stringify(entity.props));
    }
  };
  const writeRelations = (relations: readonly Relation[]) => {
    for (const relation of relations) {
      insertRelation.run(relationId(relation), relation.auditId, relation.label, relation.from, relation.to);
    }
  };

  const saveEntities = db.transaction(writeEntities);
  const saveRelations = db.transaction(writeRelations);
  const saveFindings = db.transaction((findings: readonly Finding[]) => {
    for (const finding of findings) {
      writeEntities(finding.entities);
      writeRelations(finding.relations);
      upsertFinding.run(
        findingSlotKey(finding),
        finding.auditId,
        finding.source,
        finding.url,
        finding.foundAt,
        finding.confidence,
        finding.result,
        finding.reason,
        JSON.stringify(finding.entities.map(entityId)),
        JSON.stringify(finding.relations.map(relationId)),
      );
    }
  });

  const entityById = (id: EntityId): Entity => {
    const row = selectEntity.get(id);
    if (!row) throw new Error(`stored finding points to missing entity ${id}`);
    return toEntity(row);
  };
  const relationById = (id: string): Relation => {
    const row = selectRelation.get(id);
    if (!row) throw new Error(`stored finding points to missing relation ${id}`);
    return toRelation(row);
  };

  return {
    async saveAudit(audit) {
      upsertAudit.run(audit.id, audit.subjectName);
    },
    async getAudit(id) {
      const row = selectAudit.get(id);
      return row ? toAudit(row) : null;
    },
    async listAudits() {
      return selectAudits.all().map(toAudit);
    },
    async saveEntities(entities) {
      saveEntities(entities);
    },
    async listEntities(auditId) {
      return selectEntities.all(auditId).map(toEntity);
    },
    async saveRelations(relations) {
      saveRelations(relations);
    },
    async listRelations(auditId) {
      return selectRelations.all(auditId).map(toRelation);
    },
    async saveFindings(findings) {
      saveFindings(findings);
    },
    async listFindings(auditId) {
      return selectFindings.all(auditId).map((row) => ({
        auditId: row.audit_id,
        source: row.source,
        url: row.url,
        foundAt: row.found_at,
        confidence: row.confidence,
        result: row.result,
        reason: row.reason,
        entities: (JSON.parse(row.entity_ids) as EntityId[]).map(entityById),
        relations: (JSON.parse(row.relation_ids) as string[]).map(relationById),
      }));
    },
    close() {
      db.close();
    },
  };
}
