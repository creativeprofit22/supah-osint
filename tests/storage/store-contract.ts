// One contract every Store must pass: the SQLite adapter and the in-memory fake run the same tests.
import { describe, expect, test } from "bun:test";
import {
  createEntity,
  createRelation,
  entityId,
  type Audit,
  type Entity,
  type EntityOf,
  type Finding,
  type Relation,
} from "../../packages/core/src/index.ts";
import type { Store } from "../../packages/engine/src/index.ts";

const audit: Audit = { id: "audit-1", subjectName: "Ada Lovelace" };
const other: Audit = { id: "audit-2", subjectName: "Charles Babbage" };

function must<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

const person = (auditId = audit.id, name = "Ada Lovelace"): EntityOf<"Person"> =>
  must(createEntity(auditId, "Person", { name }));
const email = (auditId = audit.id): EntityOf<"Email"> =>
  must(createEntity(auditId, "Email", { address: "ada@example.com" }));
const hasEmail = (from: Entity, to: Entity): Relation => must(createRelation("has_email", from, to));

function finding(overrides: Partial<Finding> = {}): Finding {
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

export function storeContract(name: string, makeStore: () => Store | Promise<Store>): void {
  describe(`${name} meets the Store contract`, () => {
    test("audits upsert by id, load by id and list by id", async () => {
      const store = await makeStore();
      await store.saveAudit(other);
      await store.saveAudit(audit);
      await store.saveAudit({ ...audit, subjectName: "Augusta Ada King" });
      expect(await store.getAudit(audit.id)).toEqual({ ...audit, subjectName: "Augusta Ada King" });
      expect(await store.getAudit("missing")).toBeNull();
      expect(await store.listAudits()).toEqual([{ ...audit, subjectName: "Augusta Ada King" }, other]);
    });

    test("saving an entity that already exists merges it and keeps the first props", async () => {
      const store = await makeStore();
      await store.saveAudit(audit);
      const first = person(audit.id, "Ada Lovelace");
      const again = person(audit.id, "  ada   LOVELACE ");
      expect(entityId(again)).toBe(entityId(first));
      await store.saveEntities([first]);
      await store.saveEntities([again, first]);
      expect(await store.listEntities(audit.id)).toEqual([first]);
    });

    test("the same entity inside two findings is stored once", async () => {
      const store = await makeStore();
      await store.saveAudit(audit);
      const ada = person();
      await store.saveFindings([
        finding({ entities: [ada] }),
        finding({ url: "https://example.com/b", entities: [person(audit.id, "ADA lovelace")] }),
      ]);
      expect(await store.listEntities(audit.id)).toEqual([ada]);
      const [a, b] = await store.listFindings(audit.id);
      expect(a?.entities).toEqual([ada]);
      expect(b?.entities).toEqual([ada]);
    });

    test("saving the same relation twice keeps one", async () => {
      const store = await makeStore();
      await store.saveAudit(audit);
      const ada = person();
      const mail = email();
      const edge = hasEmail(ada, mail);
      await store.saveEntities([ada, mail]);
      await store.saveRelations([edge, edge]);
      await store.saveRelations([{ ...edge }]);
      expect(await store.listRelations(audit.id)).toEqual([edge]);
    });

    test("a relation to an entity that isn't stored rejects and writes nothing", async () => {
      const store = await makeStore();
      await store.saveAudit(audit);
      const ada = person();
      const mail = email();
      await store.saveEntities([ada]);
      await expect(store.saveRelations([hasEmail(ada, mail)])).rejects.toThrow();
      expect(await store.listRelations(audit.id)).toEqual([]);
    });

    test("a relation to an entity that only appears in a later finding of the batch rejects and writes nothing", async () => {
      const store = await makeStore();
      await store.saveAudit(audit);
      const ada = person();
      const mail = email();
      const early = finding({ entities: [ada], relations: [hasEmail(ada, mail)] });
      const late = finding({ url: "https://example.com/b", entities: [mail] });
      await expect(store.saveFindings([early, late])).rejects.toThrow();
      expect(await store.listFindings(audit.id)).toEqual([]);
      expect(await store.listEntities(audit.id)).toEqual([]);
      expect(await store.listRelations(audit.id)).toEqual([]);
    });

    test("a finding with confidence outside 0..1 rejects and writes nothing", async () => {
      const store = await makeStore();
      await store.saveAudit(audit);
      await expect(store.saveFindings([finding({ confidence: 5, entities: [person()] })])).rejects.toThrow();
      expect(await store.listFindings(audit.id)).toEqual([]);
      expect(await store.listEntities(audit.id)).toEqual([]);
    });

    test("saving for an audit that isn't stored rejects and writes nothing", async () => {
      const store = await makeStore();
      await store.saveAudit(audit);
      const ok = person();
      const stray = person(other.id);
      await expect(store.saveEntities([ok, stray])).rejects.toThrow();
      await expect(store.saveFindings([finding(), finding({ auditId: other.id })])).rejects.toThrow();
      await expect(store.saveFindings([finding({ entities: [ok, stray] })])).rejects.toThrow();
      expect(await store.listEntities(audit.id)).toEqual([]);
      expect(await store.listFindings(audit.id)).toEqual([]);
      expect(await store.getAudit(other.id)).toBeNull();
    });

    test("a rescan's not_found replaces the earlier found for the same audit, source and url", async () => {
      const store = await makeStore();
      await store.saveAudit(audit);
      await store.saveFindings([finding({}), finding({ url: "https://example.com/b" })]);
      const rescan = finding({ result: "not_found", foundAt: 2 });
      await store.saveFindings([rescan]);
      expect(await store.listFindings(audit.id)).toEqual([rescan, finding({ url: "https://example.com/b" })]);
    });

    test("findings round-trip with their entities and relations", async () => {
      const store = await makeStore();
      await store.saveAudit(audit);
      const ada = person();
      const mail = email();
      const edge = hasEmail(ada, mail);
      const hit = finding({ entities: [ada, mail], relations: [edge] });
      const unsure = finding({ url: null, result: "inconclusive", reason: "rate limited", confidence: 0 });
      await store.saveFindings([hit, unsure]);
      expect(await store.listFindings(audit.id)).toEqual([hit, unsure]);
      expect(await store.listEntities(audit.id)).toEqual([ada, mail]);
      expect(await store.listRelations(audit.id)).toEqual([edge]);
    });

    test("audits don't see each other's data", async () => {
      const store = await makeStore();
      await store.saveAudit(audit);
      await store.saveAudit(other);
      const mine = person();
      const theirs = person(other.id);
      await store.saveFindings([finding({ entities: [mine] }), finding({ auditId: other.id, entities: [theirs] })]);
      expect(await store.listEntities(audit.id)).toEqual([mine]);
      expect(await store.listEntities(other.id)).toEqual([theirs]);
      expect((await store.listFindings(other.id)).map((f) => f.auditId)).toEqual([other.id]);
    });

    test("changing a saved object afterwards doesn't change what is stored", async () => {
      const store = await makeStore();
      await store.saveAudit(audit);
      const ada = person();
      await store.saveEntities([ada]);
      ada.props.name = "Someone Else";
      expect(await store.listEntities(audit.id)).toEqual([person()]);
    });
  });
}
