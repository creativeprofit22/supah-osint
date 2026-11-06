import { expect, test } from "bun:test";
import { entityId } from "../../packages/core/src/index.ts";
import { crtshQueryUrl, crtshSource } from "../../packages/sources/crtsh/src/index.ts";
import { domain, effRoutes, fixtureHttp, keysOf, runSource } from "./fixture-http.ts";

const CRTSH = "packages/sources/crtsh/fixtures";
const source = crtshSource({ now: () => 3 });

test("turns certificate names into deduped subdomains of the audited domain", async () => {
  const eff = domain("eff.org");
  const [finding] = await runSource(source, eff, fixtureHttp(effRoutes));
  expect(finding?.result).toBe("found");
  expect(finding?.confidence).toBe(0.8);
  const subdomains = keysOf(finding, "Domain").filter((key) => key !== "eff.org");
  expect(subdomains).toContain("supporters.dev.eff.org");
  expect(subdomains).toContain("dev.eff.org"); // from "*.dev.eff.org"
  expect(subdomains.every((key) => key.endsWith(".eff.org") && !key.includes("*"))).toBe(true);
  expect(new Set(subdomains).size).toBe(subdomains.length);
  expect(finding?.relations).toHaveLength(subdomains.length);
  expect(finding?.relations.every((r) => r.label === "subdomain_of" && r.to === entityId(eff))).toBe(true);
});

test("no certificates is not found; errors and broken JSON are inconclusive", async () => {
  const url = crtshQueryUrl("example.org");
  const run = (route: Parameters<typeof fixtureHttp>[0][string]) => runSource(source, domain("example.org"), fixtureHttp({ [url]: route }));
  expect((await run(`${CRTSH}/empty.json`)).map((f) => f.result)).toEqual(["not_found"]);
  expect((await run({ file: `${CRTSH}/bad-gateway.html`, status: 502 })).map((f) => [f.result, f.reason])).toEqual([
    ["inconclusive", "crt.sh answered HTTP 502"],
  ]);
  expect((await run(`${CRTSH}/malformed.json`)).map((f) => [f.result, f.reason])).toEqual([["inconclusive", "crt.sh answer was not valid JSON"]]);
});

test("is rate limited to one request every five seconds", () => {
  expect(source.rateLimit).toEqual({ requests: 1, perMs: 5000 });
});
