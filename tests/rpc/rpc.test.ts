import { expect, test } from "bun:test";
import { createSourceGuard, type Http } from "../../packages/engine/src/index.ts";
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
