// Versioned schema. Never edit an applied migration: changes are new, additive migrations at the end.
import type { Database } from "bun:sqlite";

export type Migration = { version: number; sql: string };

export const MIGRATIONS: readonly Migration[] = [
  {
    // entities.type has no CHECK: core validates it, and SQLite can't widen a CHECK without a table rebuild.
    version: 1,
    sql: `
      CREATE TABLE audits (
        id TEXT PRIMARY KEY,
        subject_name TEXT NOT NULL
      );
      CREATE TABLE entities (
        id TEXT PRIMARY KEY,
        audit_id TEXT NOT NULL REFERENCES audits(id),
        type TEXT NOT NULL,
        key TEXT NOT NULL,
        props TEXT NOT NULL
      );
      CREATE INDEX entities_audit ON entities(audit_id);
      CREATE TABLE relations (
        id TEXT PRIMARY KEY,
        audit_id TEXT NOT NULL REFERENCES audits(id),
        label TEXT NOT NULL,
        from_id TEXT NOT NULL REFERENCES entities(id),
        to_id TEXT NOT NULL REFERENCES entities(id)
      );
      CREATE INDEX relations_audit ON relations(audit_id);
      CREATE TABLE findings (
        slot TEXT PRIMARY KEY,
        audit_id TEXT NOT NULL REFERENCES audits(id),
        source TEXT NOT NULL,
        url TEXT,
        found_at INTEGER NOT NULL,
        confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
        result TEXT NOT NULL CHECK (result IN ('found', 'not_found', 'inconclusive')),
        reason TEXT,
        entity_ids TEXT NOT NULL,
        relation_ids TEXT NOT NULL
      );
      CREATE INDEX findings_audit ON findings(audit_id);
    `,
  },
];

export const LATEST_VERSION = MIGRATIONS.at(-1)?.version ?? 0;

export function schemaVersion(db: Database): number {
  return db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version ?? 0;
}

export function migrate(db: Database, migrations: readonly Migration[] = MIGRATIONS): void {
  const current = schemaVersion(db);
  const latest = migrations.at(-1)?.version ?? 0;
  // A newer app wrote this file; leave it untouched rather than guess at its schema.
  if (current > latest) {
    throw new Error(`database schema version ${current} is newer than this app supports (${latest})`);
  }
  for (const migration of migrations) {
    if (migration.version <= current) continue;
    db.transaction(() => {
      db.run(migration.sql);
      db.run(`PRAGMA user_version = ${migration.version}`);
    })();
  }
}
