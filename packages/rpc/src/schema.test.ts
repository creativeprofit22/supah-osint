import { expect, test } from "bun:test";
import {
  bunHandlers,
  createAppClient,
  type DomainAudits,
  type RpcTransport,
  type SourceControls,
  type SourceHealthRow,
} from "./schema.ts";

function fakeSources(rows: SourceHealthRow[] = []) {
  const calls = {
    revived: [] as string[],
    saved: [] as { sourceId: string; keys: readonly string[] }[],
    audited: [] as { subjectName: string; domain: string }[],
  };
  const sources: SourceControls = {
    sourceHealth: () => rows,
    reviveSource: (sourceId) => {
      calls.revived.push(sourceId);
    },
    setSourceKeys: async (sourceId, keys) => {
      calls.saved.push({ sourceId, keys });
    },
  };
  const audits: DomainAudits = {
    auditDomain: async (subjectName, domain) => {
      calls.audited.push({ subjectName, domain });
      // Extra fields stand in for the full core types; they must not cross to the window.
      const finding = {
        source: "dns",
        url: "https://dns.google/x",
        result: "inconclusive",
        reason: "SERVFAIL",
        entities: [],
      } as const;
      const entity = {
        id: "a1|Domain|example.org",
        type: "Domain",
        label: "example.org",
        props: { name: "example.org" },
      };
      const relation = {
        from: "a1|Domain|mx.example.org",
        label: "subdomain_of",
        to: "a1|Domain|example.org",
        auditId: "a1",
      };
      const skipped = { sourceId: "crtsh", reason: "parked", entityId: "a1|Domain|example.org" };
      return {
        auditId: "a1",
        status: "cancelled",
        findings: [finding],
        entities: [entity],
        relations: [relation],
        skipped: [skipped],
      };
    },
  };
  return { sources, audits, calls };
}

function setup(rows?: SourceHealthRow[]) {
  const { sources, audits, calls } = fakeSources(rows);
  const handlers = bunHandlers({ now: () => 2000, bunVersion: "1.4.4", sources, audits });
  // Untyped call so tests can send what a misbehaving window might.
  const call = (name: string, params: unknown) => (handlers as Record<string, (p: unknown) => unknown>)[name]!(params);
  const transport: RpcTransport = {
    // JSON round-trip, like the real bridge.
    request: async (name, params) => JSON.parse(JSON.stringify(await call(name, JSON.parse(JSON.stringify(params))))),
  };
  return { handlers, call, calls, client: createAppClient(transport, () => 1000) };
}

test("ping round-trips through a transport with a typed pong", async () => {
  const { client } = setup();
  expect(await client.ping()).toEqual({
    message: "pong",
    sentAt: 1000,
    repliedAt: 2000,
    bunVersion: "1.4.4",
  });
});

test("sourceHealth round-trips the guard's rows", async () => {
  const rows: SourceHealthRow[] = [
    { sourceId: "a", state: "ok", failures: 1, parkedUntil: null },
    { sourceId: "b", state: "parked", failures: 3, parkedUntil: 9000 },
  ];
  const { client } = setup(rows);
  expect(await client.sourceHealth()).toEqual(rows);
});

test("reviveSource round-trips and reaches the source controls", async () => {
  const { client, calls } = setup();
  expect(await client.reviveSource("b")).toEqual({ revived: true });
  expect(calls.revived).toEqual(["b"]);
});

test("setSourceKeys saves the keys and answers with a count only", async () => {
  const { client, calls } = setup();
  const reply = await client.setSourceKeys("shodan", ["sk-secret-one", "sk-secret-two"]);
  expect(reply).toEqual({ saved: 2 });
  expect(JSON.stringify(reply)).not.toContain("sk-secret");
  expect(calls.saved).toEqual([{ sourceId: "shodan", keys: ["sk-secret-one", "sk-secret-two"] }]);
});

test("bunHandlers rejects a bad sourceId", async () => {
  const { call, calls } = setup();
  for (const params of [{ sourceId: "" }, { sourceId: "   " }, { sourceId: 7 }, {}, undefined]) {
    await expect(Promise.resolve().then(() => call("reviveSource", params))).rejects.toThrow("sourceId");
    await expect(Promise.resolve().then(() => call("setSourceKeys", { ...params, keys: ["k"] }))).rejects.toThrow(
      "sourceId",
    );
  }
  expect(calls.revived).toEqual([]);
  expect(calls.saved).toEqual([]);
});

test("bunHandlers rejects bad keys without echoing them", async () => {
  const { call, calls } = setup();
  for (const keys of [undefined, "sk-secret", ["sk-secret", 5], [null], { 0: "sk-secret" }]) {
    const error = await Promise.resolve()
      .then(() => call("setSourceKeys", { sourceId: "shodan", keys }))
      .then(
        () => null,
        (caught: Error) => caught,
      );
    expect(error?.message).toBe("keys must be an array of strings");
  }
  expect(calls.saved).toEqual([]);
});

test("auditDomain round-trips plain rows only", async () => {
  const { client, calls } = setup();
  expect(await client.auditDomain("Ada", "example.org")).toEqual({
    auditId: "a1",
    status: "cancelled",
    findings: [{ source: "dns", url: "https://dns.google/x", result: "inconclusive", reason: "SERVFAIL" }],
    entities: [{ id: "a1|Domain|example.org", type: "Domain", label: "example.org" }],
    relations: [{ from: "a1|Domain|mx.example.org", label: "subdomain_of", to: "a1|Domain|example.org" }],
    skipped: [{ sourceId: "crtsh", reason: "parked" }],
  });
  expect(calls.audited).toEqual([{ subjectName: "Ada", domain: "example.org" }]);
});

test("bunHandlers rejects an empty subject name or domain", async () => {
  const { call, calls } = setup();
  const bad = [
    { subjectName: "Ada" },
    { subjectName: " ", domain: "example.org" },
    { subjectName: "Ada", domain: 3 },
    undefined,
  ];
  for (const params of bad) {
    await expect(Promise.resolve().then(() => call("auditDomain", params))).rejects.toThrow(
      "must be a non-empty string",
    );
  }
  expect(calls.audited).toEqual([]);
});
