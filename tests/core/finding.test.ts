import { describe, expect, test } from "bun:test";
import {
  createEntity,
  createFinding,
  createRelation,
  dedupeFindings,
  entityId,
  mergeGraph,
  type Finding,
  type Relation,
  type Result,
} from "../../packages/core/src/index.ts";

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

const person = value(createEntity("audit-1", "Person", { name: "Bob Smith" }));
const email = value(createEntity("audit-1", "Email", { address: "Bob@Example.com" }));
const sameEmail = value(createEntity("audit-1", "Email", { address: "bob@example.com" }));
const hasEmail = value(createRelation("has_email", person, email));

function base(overrides: Partial<Finding> = {}): Finding {
  return {
    auditId: "audit-1",
    source: "test-source",
    url: "https://example.com/bob",
    foundAt: 1_000,
    confidence: 0.9,
    result: "found",
    reason: null,
    entities: [person, email],
    relations: [hasEmail],
    ...overrides,
  };
}

describe("createFinding", () => {
  test("all three results can be built", () => {
    expect(createFinding(base()).ok).toBe(true);
    expect(createFinding(base({ result: "not_found", entities: [], relations: [] })).ok).toBe(true);
    const inconclusive = createFinding(
      base({ result: "inconclusive", reason: "rate limited", url: null, entities: [], relations: [] }),
    );
    expect(inconclusive.ok).toBe(true);
  });

  test("inconclusive needs a reason", () => {
    expect(createFinding(base({ result: "inconclusive", reason: null, entities: [], relations: [] })).ok).toBe(false);
    expect(createFinding(base({ result: "inconclusive", reason: "  ", entities: [], relations: [] })).ok).toBe(false);
  });

  test("not_found cannot carry entities", () => {
    expect(createFinding(base({ result: "not_found", relations: [] })).ok).toBe(false);
  });

  test("confidence must be between 0 and 1", () => {
    expect(createFinding(base({ confidence: 1.5 })).ok).toBe(false);
    expect(createFinding(base({ confidence: -0.1 })).ok).toBe(false);
    expect(createFinding(base({ confidence: Number.NaN })).ok).toBe(false);
  });

  test("relations must point at entities in the finding", () => {
    expect(createFinding(base({ entities: [person] })).ok).toBe(false);
  });

  test("relations must use an allowed edge", () => {
    const phone = value(createEntity("audit-1", "Phone", { number: "+14155550100" }));
    const badEdge: Relation = { auditId: "audit-1", label: "has_email", from: entityId(phone), to: entityId(email) };
    const result = createFinding(base({ entities: [phone, email], relations: [badEdge] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("edge not allowed: Phone has_email Email");
  });

  test("entities must belong to the finding's audit", () => {
    const stranger = value(createEntity("audit-2", "Person", { name: "Eve" }));
    expect(createFinding(base({ entities: [person, email, stranger] })).ok).toBe(false);
  });
});

describe("mergeGraph", () => {
  test("dedupes entities and relations across findings and ignores non-found ones", () => {
    const first = value(createFinding(base()));
    const second = value(createFinding(base({ source: "other", entities: [person, sameEmail] })));
    const miss = value(createFinding(base({ source: "miss", result: "not_found", entities: [], relations: [] })));
    const graph = mergeGraph([first, second, miss]);
    expect(graph.entities).toHaveLength(2);
    expect(graph.relations).toHaveLength(1);
    expect(mergeGraph([miss]).entities).toHaveLength(0);
  });
});

describe("dedupeFindings", () => {
  test("merges entities of found findings that share a key instead of dropping them", () => {
    const phone = value(createEntity("audit-1", "Phone", { number: "+14155550100" }));
    const first = value(createFinding(base({ url: null, confidence: 0.4 })));
    const second = value(createFinding(base({ url: null, confidence: 0.8, entities: [phone], relations: [] })));
    const merged = dedupeFindings([first, second]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.entities).toHaveLength(3);
    expect(merged[0]?.entities).toContainEqual(phone);
    expect(merged[0]?.relations).toEqual([hasEmail]);
    expect(merged[0]?.confidence).toBe(0.8);
  });

  test("still collapses repeated not_found findings", () => {
    const miss = base({ result: "not_found", entities: [], relations: [] });
    expect(dedupeFindings([miss, { ...miss, foundAt: 2_000 }])).toEqual([miss]);
  });
});

describe("dedupeFindings within one scan", () => {
  test("found wins over not_found and inconclusive for the same slot, in any order", () => {
    const hit = value(createFinding(base({ url: null })));
    const miss = base({ url: null, result: "not_found", entities: [], relations: [] });
    const unsure = base({ url: null, result: "inconclusive", reason: "timeout", entities: [], relations: [] });
    expect(dedupeFindings([hit, miss, unsure])).toEqual([hit]);
    expect(dedupeFindings([miss, unsure, hit])).toEqual([hit]);
    expect(dedupeFindings([miss, unsure])).toEqual([unsure]);
  });
});
