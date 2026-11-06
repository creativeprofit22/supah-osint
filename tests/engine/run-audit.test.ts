import { expect, test } from "bun:test";
import { entityId, type Entity } from "../../packages/core/src/index.ts";
import { createSourceGuard, runAudit, staticKeys, type Http, type Source } from "../../packages/engine/src/index.ts";
import { createFakeClock } from "./fake-clock.ts";
import { createMemoryStore } from "../../packages/storage/src/index.ts";
import { account, audit, callLog, email, fakeSource, finding, http, linkFinding } from "./fake-sources.ts";

test("drops findings for another audit, that break the Finding rules or claim another source", async () => {
  const valid = finding("fake");
  const otherAudit = finding("fake", { auditId: "audit-2", url: "https://example.com/b" });
  const noReason = finding("fake", { result: "inconclusive", reason: null, url: "https://example.com/c" });
  const badConfidence = finding("fake", { confidence: 5, url: "https://example.com/d" });
  const wrongSource = finding("someone-else", { url: "https://example.com/e" });
  const source = fakeSource({
    id: "fake",
    accepts: ["Person"],
    calls: callLog(),
    produce: () => [valid, otherAudit, noReason, badConfidence, wrongSource],
  });
  const store = createMemoryStore();

  const run = await runAudit({ sources: [source], store, http }, { audit });

  expect(run.status).toBe("done");
  expect(run.findings).toEqual([valid]);
  expect(await store.getAudit(audit.id)).toEqual(audit);
  expect(await store.listFindings(audit.id)).toEqual([valid]);
  expect(await store.listFindings("audit-2")).toEqual([]);
});

test("keeps a found when the same source also reports not_found for that url", async () => {
  const hit = finding("fake");
  const miss = finding("fake", { result: "not_found", foundAt: 2 });
  const source = fakeSource({ id: "fake", accepts: ["Person"], calls: callLog(), produce: () => [hit, miss] });
  const store = createMemoryStore();
  await runAudit({ sources: [source], store, http }, { audit });
  expect(await store.listFindings(audit.id)).toEqual([hit]);
});

test("chains email -> account -> linked accounts and runs each source on each input once", async () => {
  const calls = callLog();
  const seed = email("ada@example.com");
  const gravatar = account("gravatar", "ada");
  const github = account("github", "ada");
  const x = account("x", "ada");
  const emailToAccount = fakeSource({
    id: "email-to-account",
    accepts: ["Email"],
    calls,
    produce: (input) => [linkFinding("email-to-account", gravatar, "has_email", [input])],
  });
  // Reports every other account back, which must not re-trigger lookups.
  const accountSearch = fakeSource({
    id: "account-search",
    accepts: ["Account"],
    calls,
    produce: (input) => {
      const others = [gravatar, github, x].filter((other) => entityId(other) !== entityId(input));
      return [linkFinding("account-search", input, "linked_to", others)];
    },
  });
  const store = createMemoryStore();

  const run = await runAudit({ sources: [emailToAccount, accountSearch], store, http }, { audit, seeds: [seed] });

  expect(run.status).toBe("done");
  expect(calls.map((call) => `${call.sourceId}|${call.entityId}`).sort()).toEqual(
    [
      `email-to-account|${entityId(seed)}`,
      `account-search|${entityId(gravatar)}`,
      `account-search|${entityId(github)}`,
      `account-search|${entityId(x)}`,
    ].sort(),
  );
  const saved = (await store.listEntities(audit.id)).map(entityId);
  for (const entity of [seed, gravatar, github, x]) expect(saved).toContain(entityId(entity));
});

test("an entity type no source accepts is never sent to other sources", async () => {
  const calls = callLog();
  const phoneOnly = fakeSource({ id: "phone-only", accepts: ["Phone"], calls, produce: () => [] });
  const emailToAccount = fakeSource({
    id: "email-to-account",
    accepts: ["Email"],
    calls,
    produce: (input) => [linkFinding("email-to-account", account("gravatar", "ada"), "has_email", [input])],
  });
  await runAudit(
    { sources: [phoneOnly, emailToAccount], store: createMemoryStore(), http },
    { audit, seeds: [email("ada@example.com")] },
  );
  expect(calls.map((call) => call.sourceId)).toEqual(["email-to-account"]);
});

test("the depth limit stops the chain but still saves the deepest entity", async () => {
  const calls = callLog();
  let next = 0;
  const made: Entity[] = [];
  const chain = fakeSource({
    id: "chain",
    accepts: ["Account"],
    calls,
    produce: (input) => {
      next += 1;
      const linked = account("site", `user${next}`);
      made.push(linked);
      return [linkFinding("chain", input, "linked_to", [linked])];
    },
  });
  const store = createMemoryStore();

  await runAudit({ sources: [chain], store, http }, { audit, seeds: [account("site", "user0")], maxDepth: 2 });

  expect(calls).toHaveLength(3);
  const deepest = made[2];
  if (!deepest) throw new Error("expected three linked accounts");
  expect(calls.map((call) => call.entityId)).not.toContain(entityId(deepest));
  expect((await store.listEntities(audit.id)).map(entityId)).toContain(entityId(deepest));
});

test("entities not linked to the subject are saved but never looked up", async () => {
  const calls = callLog();
  const seed = email("ada@example.com");
  const linked = account("github", "ada");
  const stranger = account("github", "stranger");
  const emailSource = fakeSource({
    id: "email-source",
    accepts: ["Email"],
    calls,
    produce: (input) => [linkFinding("email-source", linked, "has_email", [input], [stranger])],
  });
  const accountSource = fakeSource({ id: "account-source", accepts: ["Account"], calls, produce: () => [] });
  const store = createMemoryStore();

  await runAudit({ sources: [emailSource, accountSource], store, http }, { audit, seeds: [seed] });

  const looked = calls.map((call) => call.entityId);
  expect(looked).toContain(entityId(linked));
  expect(looked).not.toContain(entityId(stranger));
  expect((await store.listEntities(audit.id)).map(entityId)).toContain(entityId(stranger));
});

test("a seed from another audit is rejected", async () => {
  const deps = { sources: [], store: createMemoryStore(), http };
  await expect(runAudit(deps, { audit, seeds: [email("ada@example.com", "audit-2")] })).rejects.toThrow(
    "another audit",
  );
});

test("a source that needs a key is skipped without one and gets it when set; canRun false skips", async () => {
  const calls = callLog();
  const keyed = fakeSource({ id: "keyed", accepts: ["Person"], keyRequirement: "required", calls, produce: () => [] });
  const optional = fakeSource({
    id: "optional",
    accepts: ["Person"],
    keyRequirement: "optional",
    calls,
    produce: () => [],
  });
  const refuses = fakeSource({ id: "refuses", accepts: ["Person"], canRun: () => false, calls, produce: () => [] });

  const without = await runAudit({ sources: [keyed, optional, refuses], store: createMemoryStore(), http }, { audit });
  expect(calls.map((call) => [call.sourceId, call.key])).toEqual([["optional", null]]);
  expect(without.skipped.map((skip) => [skip.sourceId, skip.reason])).toEqual([
    ["keyed", "missing key"],
    ["refuses", "cannot run"],
  ]);

  calls.length = 0;
  const withKey = await runAudit(
    { sources: [keyed], store: createMemoryStore(), http, keys: staticKeys({ keyed: ["secret"] }) },
    { audit },
  );
  expect(withKey.skipped).toEqual([]);
  expect(calls.map((call) => call.key)).toEqual(["secret"]);
});

test("a throwing source becomes an inconclusive finding and other sources still finish", async () => {
  const broken: Source = {
    id: "broken",
    accepts: ["Person"],
    keyRequirement: "none",
    run: () => ({
      [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error("rate limited")) }),
    }),
  };
  const fine = fakeSource({ id: "fine", accepts: ["Person"], calls: callLog(), produce: () => [finding("fine")] });
  const store = createMemoryStore();

  const run = await runAudit({ sources: [broken, fine], store, http }, { audit });

  expect(run.status).toBe("done");
  expect(run.findings).toContainEqual(finding("fine"));
  expect(run.findings.find((item) => item.source === "broken")).toMatchObject({
    result: "inconclusive",
    reason: "rate limited",
  });
});

test("cancelling stops every running source within a second and keeps what was found", async () => {
  let politeSawAbort = false;
  const early = finding("polite");
  const polite: Source = {
    id: "polite",
    accepts: ["Person"],
    keyRequirement: "none",
    async *run(_input, ctx) {
      yield early;
      await new Promise<void>((resolve) => ctx.signal.addEventListener("abort", () => resolve(), { once: true }));
      politeSawAbort = ctx.signal.aborted;
    },
  };
  // Ignores the signal and never settles.
  const stubborn: Source = {
    id: "stubborn",
    accepts: ["Person"],
    keyRequirement: "none",
    run: () => ({ [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => {}) }) }),
  };
  const controller = new AbortController();
  const store = createMemoryStore();
  setTimeout(() => controller.abort(), 50);
  const started = Date.now();

  const run = await runAudit({ sources: [polite, stubborn], store, http }, { audit, signal: controller.signal });

  expect(Date.now() - started).toBeLessThan(1000);
  expect(run.status).toBe("cancelled");
  expect(politeSawAbort).toBe(true);
  expect(await store.listFindings(audit.id)).toEqual([early]);
});

test("a canRun that throws becomes an inconclusive finding and other findings are still saved", async () => {
  const calls = callLog();
  const badDryRun = fakeSource({
    id: "bad-dry-run",
    accepts: ["Person"],
    canRun: () => {
      throw new Error("bad dry run");
    },
    calls,
    produce: () => [],
  });
  const fine = fakeSource({ id: "fine", accepts: ["Person"], calls, produce: () => [finding("fine")] });
  const store = createMemoryStore();

  const run = await runAudit({ sources: [badDryRun, fine], store, http }, { audit });

  expect(run.status).toBe("done");
  expect(calls.map((call) => call.sourceId)).toEqual(["fine"]);
  expect(await store.listFindings(audit.id)).toContainEqual(finding("fine"));
  expect(run.findings.find((item) => item.source === "bad-dry-run")).toMatchObject({
    result: "inconclusive",
    reason: "bad dry run",
  });
});

test("a source that fails on every input leaves one inconclusive finding per input", async () => {
  const first = email("ada@example.com");
  const second = email("lovelace@example.com");
  const flaky = fakeSource({
    id: "flaky",
    accepts: ["Email"],
    calls: callLog(),
    produce: () => {
      throw new Error("timed out");
    },
  });
  const store = createMemoryStore();

  const run = await runAudit({ sources: [flaky], store, http }, { audit, seeds: [first, second] });

  for (const findings of [run.findings, await store.listFindings(audit.id)]) {
    const failures = findings.filter((item) => item.source === "flaky");
    expect(failures).toHaveLength(2);
    expect(failures.every((item) => item.result === "inconclusive" && item.reason === "timed out")).toBe(true);
    expect(failures.map((item) => item.url).sort()).toEqual(
      [`engine-failure:${entityId(first)}`, `engine-failure:${entityId(second)}`].sort(),
    );
  }
});

test("cancelling aborts the in-flight request a source makes through ctx.http", async () => {
  let received: AbortSignal | undefined;
  const waitingHttp: Http = {
    get: (_url, options) => {
      received = options?.signal;
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    },
  };
  const fetcher: Source = {
    id: "fetcher",
    accepts: ["Person"],
    keyRequirement: "none",
    async *run(_input, ctx) {
      await ctx.http.get("https://example.com", { signal: ctx.signal });
      yield finding("fetcher");
    },
  };
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 50);

  const run = await runAudit(
    { sources: [fetcher], store: createMemoryStore(), http: waitingHttp },
    { audit, signal: controller.signal },
  );

  expect(received?.aborted).toBe(true);
  expect(run.status).toBe("cancelled");
});

test("a source that keeps failing is parked across audits while the others carry on, until revived", async () => {
  const guard = createSourceGuard({ clock: createFakeClock(), park: { afterFailures: 2, coolDownMs: 60_000 } });
  const calls = callLog();
  const flaky = fakeSource({
    id: "flaky",
    accepts: ["Person"],
    calls,
    produce: () => Promise.reject(new Error("down")),
  });
  const fine = fakeSource({ id: "fine", accepts: ["Person"], calls, produce: () => [finding("fine")] });
  const run = () => runAudit({ sources: [flaky, fine], store: createMemoryStore(), http, guard }, { audit });

  await run();
  await run();
  calls.length = 0;
  const parked = await run();
  expect(parked.status).toBe("done");
  expect(parked.skipped.map((skip) => [skip.sourceId, skip.reason])).toEqual([["flaky", "parked"]]);
  expect(parked.findings.map((found) => found.source)).toEqual(["fine"]);
  expect(calls.map((call) => call.sourceId)).toEqual(["fine"]);

  guard.revive("flaky");
  calls.length = 0;
  const revived = await run();
  expect(revived.skipped).toEqual([]);
  expect(calls.map((call) => call.sourceId)).toEqual(["flaky", "fine"]);
});

test("rotates through a source's keys, one per lookup", async () => {
  const calls = callLog();
  const keyed = fakeSource({ id: "keyed", accepts: ["Email"], keyRequirement: "required", calls, produce: () => [] });
  await runAudit(
    { sources: [keyed], store: createMemoryStore(), http, keys: staticKeys({ keyed: ["k1", "k2"] }) },
    { audit, seeds: [email("a@example.com"), email("b@example.com"), email("c@example.com")] },
  );
  expect(calls.map((call) => call.key)).toEqual(["k1", "k2", "k1"]);
});

test("never stores a source's API key, from errors, urls, reasons or entity props", async () => {
  const key = "fake-test-token-42";
  const leaky = fakeSource({
    id: "leaky",
    accepts: ["Email"],
    calls: callLog(),
    produce: (input) => {
      if (entityId(input) === entityId(email("boom@example.com"))) {
        return Promise.reject(new Error(`GET https://api.example.com/?key=${key} failed`));
      }
      return [
        finding("leaky", { url: `https://api.example.com/?key=${key}`, result: "inconclusive", reason: `used ${key}` }),
        finding("leaky", { url: "https://example.com/props", entities: [account("github", key)] }),
      ];
    },
  });
  const store = createMemoryStore();
  const run = await runAudit(
    { sources: [leaky], store, http, keys: staticKeys({ leaky: [key, "spare"] }) },
    { audit, seeds: [email("ok@example.com"), email("boom@example.com")] },
  );
  const saved = JSON.stringify(await store.listFindings(audit.id)) + JSON.stringify(await store.listEntities(audit.id));
  expect(saved).not.toContain(key);
  expect(run.findings).toHaveLength(2);
  const scrubbed = run.findings.find((found) => found.url === "https://api.example.com/?key=[redacted]");
  expect(scrubbed?.reason).toBe("used [redacted]");
  const failure = run.findings.find((found) => found.url?.startsWith("engine-failure:"));
  expect(failure?.reason).toBe("GET https://api.example.com/?key=[redacted] failed");
});
