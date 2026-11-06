import { expect, test } from "bun:test";
import { createEntity, entityId } from "../../packages/core/src/index.ts";
import { createSourceGuard, type Http, type Source } from "../../packages/engine/src/index.ts";
import { createRpc, type WritableKeys } from "../../packages/rpc/src/index.ts";
import { createMemoryStore } from "../../packages/storage/src/index.ts";
import { createFakeClock } from "../engine/fake-clock.ts";

const http: Http = { get: async () => ({ status: 200, body: "" }) };

function parkedRpc(keys: WritableKeys) {
  const guard = createSourceGuard({ clock: createFakeClock() });
  const rpc = createRpc({ sources: [], store: createMemoryStore(), http, guard, keys });
  for (let n = 0; n < 3; n += 1) guard.recordFailure("s");
  expect(rpc.sourceHealth().find((h) => h.sourceId === "s")?.state).toBe("parked");
  return rpc;
}

test("saving new keys revives a parked source", async () => {
  const saved = new Map<string, readonly string[]>();
  const rpc = parkedRpc({ list: async (id) => saved.get(id) ?? [], set: async (id, keys) => void saved.set(id, keys) });
  await rpc.setSourceKeys("s", ["new"]);
  expect(saved.get("s")).toEqual(["new"]);
  expect(rpc.sourceHealth().find((h) => h.sourceId === "s")?.state).toBe("ok");
});

test("a failed key save leaves the source parked", async () => {
  const rpc = parkedRpc({
    list: async () => [],
    set: async () => {
      throw new Error("read-only");
    },
  });
  await expect(rpc.setSourceKeys("s", ["new"])).rejects.toThrow("read-only");
  expect(rpc.sourceHealth().find((h) => h.sourceId === "s")?.state).toBe("parked");
});

test("auditDomain looks up only the domain and rejects a bad one", async () => {
  const seen: string[] = [];
  const probe: Source = {
    id: "probe",
    accepts: ["Domain"],
    keyRequirement: "none",
    async *run(input, ctx) {
      seen.push(input.key);
      const sub = createEntity(ctx.audit.id, "Domain", { name: `mail.${input.key}` });
      if (!sub.ok || input.type !== "Domain") return;
      yield {
        auditId: ctx.audit.id,
        source: "probe",
        url: null,
        result: "found",
        foundAt: 1,
        confidence: 1,
        reason: null,
        entities: [input, sub.value],
        relations: [{ auditId: ctx.audit.id, label: "subdomain_of", from: entityId(sub.value), to: entityId(input) }],
      };
    },
  };
  const rpc = createRpc({ sources: [probe], store: createMemoryStore(), http });
  const run = await rpc.auditDomain("Ada Lovelace", "Example.ORG");
  // Depth 0: the subdomain it found is not looked up in turn.
  expect(seen).toEqual(["example.org"]);
  expect(run.entities.map((entity) => entity.label).sort()).toEqual(["example.org", "mail.example.org"]);
  expect(run.relations.map((relation) => relation.label)).toEqual(["subdomain_of"]);
  expect(await rpc.findings(run.auditId)).toHaveLength(1);
  await expect(rpc.auditDomain("Ada Lovelace", "not a domain")).rejects.toThrow(TypeError);
});

test("auditDomain reports a parked source as skipped instead of dropping it", async () => {
  const guard = createSourceGuard({ clock: createFakeClock() });
  const seen: string[] = [];
  const crtsh: Source = {
    id: "crtsh",
    accepts: ["Domain"],
    keyRequirement: "none",
    async *run(input) {
      seen.push(input.key);
      // Never reached while parked; yields nothing if it runs.
      yield* [];
    },
  };
  const rpc = createRpc({ sources: [crtsh], store: createMemoryStore(), http, guard });
  for (let n = 0; n < 3; n += 1) guard.recordFailure("crtsh");
  const run = await rpc.auditDomain("Ada Lovelace", "example.org");
  expect(seen).toEqual([]);
  expect(run.findings).toEqual([]);
  expect(run.skipped).toEqual([{ sourceId: "crtsh", reason: "parked" }]);
});

test("auditDomain stops at its deadline and returns the partial findings as cancelled", async () => {
  const stuck: Source = {
    id: "stuck",
    accepts: ["Domain"],
    keyRequirement: "none",
    async *run(input, ctx) {
      yield {
        auditId: ctx.audit.id,
        source: "stuck",
        url: null,
        result: "found",
        foundAt: 1,
        confidence: 1,
        reason: null,
        entities: [input],
        relations: [],
      };
      // A host that never answers: wait until the audit is aborted.
      await new Promise((resolve) => ctx.signal.addEventListener("abort", resolve, { once: true }));
    },
  };
  const rpc = createRpc({ sources: [stuck], store: createMemoryStore(), http, auditDeadlineMs: 20 });
  const run = await rpc.auditDomain("Ada Lovelace", "example.org");
  expect(run.status).toBe("cancelled");
  expect(run.findings).toHaveLength(1);
  expect(await rpc.findings(run.auditId)).toHaveLength(1);
});
