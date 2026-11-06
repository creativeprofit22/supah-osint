import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDesktop } from "../../apps/desktop/src/index.ts";
import { openSqliteStore } from "../../packages/storage/src/index.ts";

test("startDesktop saves audits to the SQLite file, so they survive a restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "supah-desktop-"));
  try {
    const path = join(dir, "app.db");
    const audit = { id: "audit-1", subjectName: "Ada Lovelace" };
    const rpc = startDesktop(path);
    try {
      await rpc.search(audit);
    } finally {
      rpc.close();
    }
    const reopened = openSqliteStore(path);
    try {
      expect(await reopened.getAudit(audit.id)).toEqual(audit);
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
