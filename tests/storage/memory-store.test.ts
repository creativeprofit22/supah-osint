import { expect, test } from "bun:test";
import type { Finding } from "../../packages/core/src/index.ts";
import { createMemoryStore } from "../../packages/storage/src/index.ts";

function finding(overrides: Partial<Finding>): Finding {
  return {
    auditId: "audit-1",
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

test("a rescan's not_found replaces the earlier found for the same audit, source and url", async () => {
  const store = createMemoryStore();
  await store.saveFindings([finding({})]);
  const rescan = finding({ result: "not_found", foundAt: 2 });
  await store.saveFindings([rescan]);
  expect(await store.listFindings("audit-1")).toEqual([rescan]);
});
