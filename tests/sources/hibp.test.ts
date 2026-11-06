import { describe, expect, test } from "bun:test";
import { hibpAccountUrl, hibpBreachUrl, hibpSource, parseBreaches } from "../../packages/sources/hibp/src/index.ts";
import { email, fixtureHttp, keysOf, runSource, type Route } from "./fixture-http.ts";

const DIR = "packages/sources/hibp/fixtures";
// HIBP's documented test key; it only works for the hibp-integration-tests.com addresses.
const KEY = "00000000000000000000000000000000";
const FOUND = "multiple-breaches@hibp-integration-tests.com";
const MISSING = "not-on-the-list@hibp-integration-tests.com";
const now = () => 1_700_000_000_000;

async function lookup(address: string, route: Route) {
  const http = fixtureHttp({ [hibpAccountUrl(address)]: route });
  const findings = await runSource(hibpSource({ now }), email(address), http, KEY);
  return { findings, http };
}

describe("hibp source (recorded from the live API with the test key)", () => {
  test("found: one finding per breach, each linking the email to the breach", async () => {
    const { findings } = await lookup(FOUND, `${DIR}/multiple-breaches.json`);
    expect(findings.map((f) => f.result)).toEqual(["found", "found", "found"]);
    expect(findings.map((f) => keysOf(f, "Breach")[0])).toEqual(["adobe", "stratfor", "gawker"]);
    const adobe = findings[0];
    expect(adobe?.url).toBe(hibpBreachUrl("Adobe", FOUND));
    expect(adobe?.source).toBe("hibp");
    expect(adobe?.foundAt).toBe(now());
    expect(adobe?.relations.map((r) => r.label)).toEqual(["exposed_in"]);
    expect(keysOf(adobe, "Email")).toEqual([FOUND]);
  });

  test("found: only the breach name, title and date are kept", async () => {
    const { findings } = await lookup(FOUND, `${DIR}/multiple-breaches.json`);
    const breach = findings[0]?.entities.find((e) => e.type === "Breach");
    expect(breach?.props).toEqual({ name: "Adobe", title: "Adobe", breachDate: "2013-10-04" });
    const saved = JSON.stringify(findings);
    for (const banned of ["DataClasses", "Description", "Passwords", "password", "PwnCount", "hash"]) {
      expect(saved).not.toContain(banned);
    }
  });

  test("not found: a 404 is one not_found at the account URL", async () => {
    const { findings } = await lookup(MISSING, { file: `${DIR}/not-found.txt`, status: 404 });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ result: "not_found", url: hibpAccountUrl(MISSING), entities: [] });
  });

  test("not found: an empty list is not_found too", async () => {
    const { findings } = await lookup(MISSING, `${DIR}/empty.json`);
    expect(findings.map((f) => f.result)).toEqual(["not_found"]);
  });

  test("sends the key only in a header, with the email URL-encoded", async () => {
    const { http } = await lookup(FOUND, `${DIR}/multiple-breaches.json`);
    expect(http.calls).toEqual([
      "https://haveibeenpwned.com/api/v3/breachedaccount/multiple-breaches%40hibp-integration-tests.com?truncateResponse=false",
    ]);
    expect(http.calls[0]).not.toContain(KEY);
    expect(http.requests[0]?.options?.headers).toMatchObject({ "hibp-api-key": KEY, "user-agent": "supah-osint" });
    expect(hibpAccountUrl("a+b@example.com")).toContain("a%2Bb%40example.com");
  });
});

describe("hibp source (hand-written error answers)", () => {
  const cases: [string, Route, string][] = [
    ["rate limited", { file: `${DIR}/rate-limited.json`, status: 429 }, "rate limited by Have I Been Pwned (HTTP 429)"],
    ["bad key", { file: `${DIR}/unauthorized.json`, status: 401 }, "Have I Been Pwned rejected the API key (HTTP 401)"],
    ["server down", { file: `${DIR}/unavailable.html`, status: 503 }, "Have I Been Pwned answered HTTP 503"],
    ["malformed JSON", `${DIR}/malformed.json`, "Have I Been Pwned answer was not a readable breach list"],
    ["not an array", `${DIR}/not-array.json`, "Have I Been Pwned answer was not a readable breach list"],
    ["item without a name", `${DIR}/missing-name.json`, "Have I Been Pwned answer was not a readable breach list"],
  ];
  for (const [name, route, reason] of cases) {
    test(`${name} is inconclusive, never not_found`, async () => {
      const { findings } = await lookup(FOUND, route);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({ result: "inconclusive", reason, entities: [] });
      expect(findings[0]?.reason).not.toContain(KEY);
    });
  }

  test("parser drops a date that is not YYYY-MM-DD instead of the breach", () => {
    expect(parseBreaches('[{"Name":"X","Title":"X","BreachDate":"soon"}]')).toEqual([
      { name: "X", title: "X", breachDate: null },
    ]);
  });

  test("declares a required key and only accepts emails", () => {
    const source = hibpSource();
    expect(source.keyRequirement).toBe("required");
    expect(source.accepts).toEqual(["Email"]);
  });
});
