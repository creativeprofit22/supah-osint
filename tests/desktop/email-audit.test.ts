import { expect, test } from "bun:test";
import { createSourceGuard, staticKeys } from "../../packages/engine/src/index.ts";
import { createRpc } from "../../packages/rpc/src/index.ts";
import { BUNDLED_SIGNUP_SITES, signupRequest } from "../../packages/sources/email-signups/src/index.ts";
import { hibpAccountUrl } from "../../packages/sources/hibp/src/index.ts";
import { createMemoryStore } from "../../packages/storage/src/index.ts";
import { createFakeClock } from "../engine/fake-clock.ts";
import { fixtureHttp, type Route } from "../sources/fixture-http.ts";

const ADDRESS = "multiple-breaches@hibp-integration-tests.com";
// HIBP's documented test key, not a real one.
const keys = staticKeys({ hibp: ["00000000000000000000000000000000"] });
const HIBP = "packages/sources/hibp/fixtures";
const SIGNUPS = "packages/sources/email-signups/fixtures";
const signupUrls = BUNDLED_SIGNUP_SITES.map((site) => signupRequest(site, ADDRESS).url);

function routes(hibp: Route = `${HIBP}/multiple-breaches.json`): Record<string, Route> {
  const [hf, wp] = signupUrls;
  return {
    [hibpAccountUrl(ADDRESS)]: hibp,
    [hf!]: `${SIGNUPS}/huggingface-missing.json`,
    [wp!]: `${SIGNUPS}/wordpress-missing.json`,
  };
}

test("an email audit links the email to its breaches and makes no sign-up checks unless asked", async () => {
  const http = fixtureHttp(routes());
  const rpc = createRpc({ sources: [], store: createMemoryStore(), http, keys });
  const run = await rpc.auditEmail("Ada Lovelace", ADDRESS, { checkRegistrations: false });

  expect(http.calls).toEqual([hibpAccountUrl(ADDRESS)]);
  const label = new Map(run.entities.map((entity) => [entity.id, entity.label]));
  const edges = run.relations.map((r) => `${label.get(r.from)} ${r.label} ${label.get(r.to)}`);
  expect(edges).toContain(`${ADDRESS} exposed_in Adobe (breached 2013-10-04)`);
  expect(run.findings.every((finding) => finding.source === "hibp" && finding.result === "found")).toBe(true);
  const stored = JSON.stringify(await rpc.findings(run.auditId));
  for (const banned of ["DataClasses", "Description", "Passwords"]) expect(stored).not.toContain(banned);
});

test("sign-up checks run only after the user turns them on", async () => {
  const http = fixtureHttp(routes());
  const rpc = createRpc({ sources: [], store: createMemoryStore(), http, keys });
  const run = await rpc.auditEmail("Ada Lovelace", ADDRESS, { checkRegistrations: true });

  expect([...http.calls].sort()).toEqual([hibpAccountUrl(ADDRESS), ...signupUrls].sort());
  const signups = run.findings.filter((finding) => finding.source === "email-signups");
  expect(signups.map((finding) => finding.result)).toEqual(["not_found", "not_found"]);
});

test("without a Have I Been Pwned key the breach lookup is skipped, not reported as clean", async () => {
  const http = fixtureHttp(routes());
  const rpc = createRpc({ sources: [], store: createMemoryStore(), http });
  const run = await rpc.auditEmail("Ada Lovelace", ADDRESS, { checkRegistrations: false });

  expect(http.calls).toEqual([]);
  expect(run.findings).toEqual([]);
  expect(run.skipped).toEqual([{ sourceId: "hibp", reason: "missing key" }]);
});

test("repeated rate limiting ends as inconclusive after the guard's retries", async () => {
  const clock = createFakeClock(1_000_000);
  const guard = createSourceGuard({ clock });
  const http = fixtureHttp(routes({ file: `${HIBP}/rate-limited.json`, status: 429 }));
  const rpc = createRpc({ sources: [], store: createMemoryStore(), http, keys, guard });
  const run = await rpc.auditEmail("Ada Lovelace", ADDRESS, { checkRegistrations: false });

  expect(http.calls).toHaveLength(3);
  expect(run.findings.map((finding) => [finding.source, finding.result])).toEqual([["hibp", "inconclusive"]]);
  expect(run.findings[0]?.reason).toContain("429");
  expect(run.findings[0]?.reason).not.toContain("00000000000000000000000000000000");
});
