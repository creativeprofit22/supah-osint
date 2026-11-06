// Uses an in-memory fake of Bun.secrets: CI's headless Linux may have no libsecret.
import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { entityId } from "../../packages/core/src/index.ts";
import { runAudit } from "../../packages/engine/src/index.ts";
import { createKeychainKeys, MAX_ENTRY_BYTES, type SecretStore } from "../../packages/keychain/src/index.ts";
import { openSqliteStore } from "../../packages/storage/src/index.ts";
import { account, audit, callLog, email, fakeSource, finding, http } from "../engine/fake-sources.ts";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fakeSecrets(): SecretStore & { entries: Map<string, string> } {
  const entries = new Map<string, string>();
  const id = (options: { service: string; name: string }) => `${options.service}/${options.name}`;
  return {
    entries,
    get: async (options) => entries.get(id(options)) ?? null,
    set: async (options) => {
      // Same cap as Windows Credential Manager, measured on Windows with Bun 1.4.4.
      if (Buffer.byteLength(options.value, "utf8") > MAX_ENTRY_BYTES) throw new Error("platform error 1783");
      if (options.value === "") entries.delete(id(options));
      else entries.set(id(options), options.value);
    },
    delete: async (options) => entries.delete(id(options)),
  };
}

test("keys round-trip through the keychain, one entry per source", async () => {
  const secrets = fakeSecrets();
  const keys = createKeychainKeys(secrets, "test-service");
  expect(await keys.list("hunter")).toEqual([]);
  await keys.set("hunter", ["k1", " k2 ", "k1", ""]);
  expect(await keys.list("hunter")).toEqual(["k1", "k2"]);
  expect([...secrets.entries.keys()]).toEqual(["test-service/source:hunter"]);
  await keys.clear("hunter");
  expect(await keys.list("hunter")).toEqual([]);
  expect(secrets.entries.size).toBe(0);
});

test("a broken keychain entry gives no keys and never throws its value", async () => {
  const secrets = fakeSecrets();
  const keys = createKeychainKeys(secrets, "test-service");
  secrets.entries.set("test-service/source:bad", "fake-test-token-42 not json");
  secrets.entries.set("test-service/source:object", '{"key":"fake-test-token-42"}');
  secrets.entries.set("test-service/source:mixed", '["k1", 7, null, ""]');
  expect(await keys.list("bad")).toEqual([]);
  expect(await keys.list("object")).toEqual([]);
  expect(await keys.list("mixed")).toEqual(["k1"]);
});

test("a key from the keychain never reaches the SQLite file", async () => {
  const key = "fake-test-token-42";
  const keys = createKeychainKeys(fakeSecrets(), "test-service");
  await keys.set("leaky", [key]);
  const leaky = fakeSource({
    id: "leaky",
    accepts: ["Email"],
    keyRequirement: "required",
    calls: callLog(),
    produce: (input, ctx) => {
      if (entityId(input) === entityId(email("boom@example.com"))) {
        return Promise.reject(new Error(`GET https://api.example.com/?key=${ctx.key} failed`));
      }
      return [
        finding("leaky", { url: `https://api.example.com/?key=${ctx.key}`, result: "inconclusive", reason: `used ${ctx.key}` }),
        finding("leaky", { url: "https://example.com/props", entities: [account("github", key)] }),
      ];
    },
  });
  const dir = mkdtempSync(join(tmpdir(), "supah-osint-keychain-"));
  dirs.push(dir);
  const path = join(dir, "test.db");
  const store = openSqliteStore(path);
  const run = await runAudit(
    { sources: [leaky], store, http, keys },
    { audit, seeds: [email("ok@example.com"), email("boom@example.com")] },
  );
  expect(run.findings).toHaveLength(2);
  const saved = JSON.stringify(await store.listFindings(audit.id)) + JSON.stringify(await store.listEntities(audit.id));
  // Close before reading: Windows keeps the db and its WAL files locked while open.
  store.close();
  expect(saved).toContain("[redacted]");
  expect(saved).not.toContain(key);
  for (const file of [path, `${path}-wal`, `${path}-shm`]) {
    if (existsSync(file)) expect(readFileSync(file).toString("latin1")).not.toContain(key);
  }
});

test("keys over the keychain size limit fail clearly and keep the old keys", async () => {
  const secrets = fakeSecrets();
  const keys = createKeychainKeys(secrets, "test-service");
  await keys.set("big", ["old-key"]);
  // ["<k>"] is the key plus 4 bytes of JSON.
  const fits = "a".repeat(MAX_ENTRY_BYTES - 4);
  await keys.set("big", [fits]);
  expect(await keys.list("big")).toEqual([fits]);
  await keys.set("big", ["old-key"]);
  // "é" is 2 bytes in UTF-8, so this is under the limit in characters but over it in bytes.
  for (const tooBig of [["fake-test-token-42" + "a".repeat(MAX_ENTRY_BYTES)], ["é".repeat(MAX_ENTRY_BYTES / 2)]]) {
    const error = await keys.set("big", tooBig).then(() => null, (e: unknown) => e as Error);
    expect(error?.message).toBe(`too many or too long keys for big (limit ${MAX_ENTRY_BYTES} bytes)`);
    expect(error?.message).not.toContain("fake-test-token-42");
  }
  expect(await keys.list("big")).toEqual(["old-key"]);
});
