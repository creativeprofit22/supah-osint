// Every database here is throwaway: ":memory:" or a file in a fresh temp folder.
import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LATEST_VERSION,
  MIGRATIONS,
  migrate,
  openSqliteStore,
  schemaVersion,
  type SqliteStore,
} from "../../packages/storage/src/index.ts";
import { storeContract } from "./store-contract.ts";

const open: SqliteStore[] = [];
const dirs: string[] = [];

afterEach(() => {
  // Close before removing: Windows keeps the db and its WAL files locked while open.
  for (const store of open.splice(0)) store.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function track(store: SqliteStore): SqliteStore {
  open.push(store);
  return store;
}

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "supah-osint-store-"));
  dirs.push(dir);
  return join(dir, "nested", "test.db");
}

storeContract("sqlite store", () => track(openSqliteStore(":memory:")));

describe("sqlite migrations", () => {
  test("a new file gets every migration, and data survives a reopen", async () => {
    const path = tempDbPath();
    const first = openSqliteStore(path);
    await first.saveAudit({ id: "audit-1", subjectName: "Ada Lovelace" });
    first.close();

    const db = new Database(path);
    expect(schemaVersion(db)).toBe(LATEST_VERSION);
    expect(db.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get()?.journal_mode).toBe("wal");
    db.close();

    const reopened = track(openSqliteStore(path));
    expect(await reopened.listAudits()).toEqual([{ id: "audit-1", subjectName: "Ada Lovelace" }]);
  });

  test("reopening doesn't rerun applied migrations", () => {
    const path = tempDbPath();
    openSqliteStore(path).close();
    // Rerunning version 1 would fail on CREATE TABLE, so a clean reopen proves it was skipped.
    expect(() => openSqliteStore(path).close()).not.toThrow();
    const db = new Database(path);
    expect(schemaVersion(db)).toBe(LATEST_VERSION);
    db.close();
  });

  test("a file from a newer app version is refused and left unchanged", () => {
    const path = tempDbPath();
    openSqliteStore(path).close();
    const db = new Database(path);
    db.run("PRAGMA journal_mode = DELETE");
    db.run(`PRAGMA user_version = ${LATEST_VERSION + 1}`);
    db.close();
    const before = readFileSync(path);

    expect(() => openSqliteStore(path)).toThrow(/newer than this app supports/);

    expect(readFileSync(path).equals(before)).toBe(true);
  });

  test("migrations are numbered 1..n and only add things", () => {
    expect(MIGRATIONS.map((m) => m.version)).toEqual(MIGRATIONS.map((_, i) => i + 1));
    for (const migration of MIGRATIONS) {
      expect(migration.sql).not.toMatch(/\b(DROP|RENAME|DELETE|UPDATE)\b/i);
    }
  });

  test("entity type isn't locked into the schema, so new types need no table rebuild", () => {
    const db = new Database(":memory:");
    migrate(db);
    const sql = db.query<{ sql: string }, []>("SELECT sql FROM sqlite_master WHERE name = 'entities'").get()?.sql;
    db.close();
    expect(sql).toContain("type TEXT NOT NULL");
    expect(sql).not.toMatch(/CHECK/i);
  });

  test("foreign keys are enforced", async () => {
    const store = track(openSqliteStore(":memory:"));
    await expect(
      store.saveEntities([{ auditId: "nope", type: "Person", key: "ada", props: { name: "Ada" } }]),
    ).rejects.toThrow(/FOREIGN KEY/);
  });
});
