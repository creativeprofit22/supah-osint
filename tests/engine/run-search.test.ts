import { expect, test } from "bun:test";
import type { Audit, Finding } from "../../packages/core/src/index.ts";
import { runSearch, type Http, type Source } from "../../packages/engine/src/index.ts";
import { createMemoryStore } from "../../packages/storage/src/index.ts";

const audit: Audit = { id: "audit-1", subjectName: "Ada Lovelace" };

function finding(overrides: Partial<Finding>): Finding {
  return {
    auditId: audit.id,
    source: "fake",
    url: "https://example.com/a",
    foundAt: 1,
    confidence: 0.9,
    result: "found",
    reason: null,
    entities: [],
    relations: [],
    ...overrides,
  };
}

const http: Http = { get: async () => ({ status: 200, body: "" }) };

test("runSearch drops findings for another audit or that break the Finding rules", async () => {
  const valid = finding({});
  const otherAudit = finding({ auditId: "audit-2", url: "https://example.com/b" });
  const noReason = finding({ result: "inconclusive", reason: null, url: "https://example.com/c" });
  const badConfidence = finding({ confidence: 5, url: "https://example.com/d" });
  const source: Source = { name: "fake", search: async () => [valid, otherAudit, noReason, badConfidence] };
  const store = createMemoryStore();

  const returned = await runSearch({ sources: [source], store, http }, audit);

  expect(returned).toEqual([valid]);
  expect(await store.listFindings(audit.id)).toEqual([valid]);
  expect(await store.listFindings("audit-2")).toEqual([]);
});

test("runSearch keeps a found when the same source also reports not_found for that url", async () => {
  const hit = finding({});
  const miss = finding({ result: "not_found", foundAt: 2 });
  const source: Source = { name: "fake", search: async () => [hit, miss] };
  const store = createMemoryStore();
  await runSearch({ sources: [source], store, http }, audit);
  expect(await store.listFindings(audit.id)).toEqual([hit]);
});
