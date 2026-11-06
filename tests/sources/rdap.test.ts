import { expect, test } from "bun:test";
import { entityId } from "../../packages/core/src/index.ts";
import { RDAP_BOOTSTRAP_URL, rdapSource } from "../../packages/sources/rdap/src/index.ts";
import { bootstrapBase } from "../../packages/sources/rdap/src/parse.ts";
import { domain, effRoutes, fixtureHttp, keysOf, runSource } from "./fixture-http.ts";

const RDAP = "packages/sources/rdap/fixtures";
const source = rdapSource({ now: () => 7 });
const PIR = "https://rdap.publicinterestregistry.org/rdap/domain/";

test("follows the registry to the registrar and links the registrant organization and email", async () => {
  const eff = domain("eff.org");
  const http = fixtureHttp(effRoutes);
  const [finding, ...rest] = await runSource(source, eff, http);
  expect(rest).toHaveLength(0);
  expect(http.calls).toEqual([RDAP_BOOTSTRAP_URL, `${PIR}eff.org`, "https://rdap.gandi.net/domain/eff.org"]);
  expect(finding?.result).toBe("found");
  expect(finding?.url).toBe(`${PIR}eff.org`);
  expect(keysOf(finding, "Organization")).toEqual(["electronic frontier foundation"]);
  expect(keysOf(finding, "Email")).toEqual(["whois@eff.org"]);
  // "Redacted for Privacy" names and the Gandi registrar contacts are skipped.
  expect(keysOf(finding, "Person")).toEqual([]);
  const edges = finding?.relations.map((r) => `${r.from} ${r.label} ${r.to}`).sort();
  const org = "audit-1|Organization|electronic frontier foundation";
  const email = "audit-1|Email|whois@eff.org";
  expect(edges).toEqual([
    `${entityId(eff)} registered_by ${email}`,
    `${entityId(eff)} registered_by ${org}`,
    `${org} has_email ${email}`,
  ]);
});

test("a record whose contacts are all redacted is not found", async () => {
  const http = fixtureHttp({
    [RDAP_BOOTSTRAP_URL]: `${RDAP}/iana-bootstrap.json`,
    [`${PIR}wikipedia.org`]: `${RDAP}/wikipedia-registry.json`,
    "https://rdap.markmonitor.com/rdap/domain/wikipedia.org": `${RDAP}/wikipedia-registrar.json`,
  });
  const findings = await runSource(source, domain("wikipedia.org"), http);
  expect(findings.map((f) => f.result)).toEqual(["not_found"]);
});

test("an unregistered domain is not found", async () => {
  const name = "this-domain-does-not-exist-supah-osint.org";
  const http = fixtureHttp({
    [RDAP_BOOTSTRAP_URL]: `${RDAP}/iana-bootstrap.json`,
    [`${PIR}${name}`]: { file: `${RDAP}/not-found.json`, status: 404 },
  });
  expect((await runSource(source, domain(name), http)).map((f) => f.result)).toEqual(["not_found"]);
});

test("unknown TLDs, server errors and a failed registrar lookup are inconclusive", async () => {
  const bootstrap = { [RDAP_BOOTSTRAP_URL]: `${RDAP}/iana-bootstrap.json` };
  const unknown = await runSource(source, domain("example.zz"), fixtureHttp(bootstrap));
  expect(unknown.map((f) => [f.result, f.reason])).toEqual([
    ["inconclusive", "no RDAP server is listed for example.zz"],
  ]);

  const down = await runSource(
    source,
    domain("eff.org"),
    fixtureHttp({ ...bootstrap, [`${PIR}eff.org`]: { file: `${RDAP}/not-found.json`, status: 503 } }),
  );
  expect(down.map((f) => [f.result, f.reason])).toEqual([["inconclusive", "RDAP server answered HTTP 503"]]);

  const registrarDown = await runSource(
    source,
    domain("eff.org"),
    fixtureHttp({
      ...effRoutes,
      "https://rdap.gandi.net/domain/eff.org": { file: `${RDAP}/not-found.json`, status: 500 },
    }),
  );
  expect(registrarDown.map((f) => [f.result, f.reason])).toEqual([
    ["inconclusive", "registrar RDAP answered HTTP 500"],
  ]);

  const garbled = await runSource(
    source,
    domain("eff.org"),
    fixtureHttp({ [RDAP_BOOTSTRAP_URL]: "packages/sources/crtsh/fixtures/malformed.json" }),
  );
  expect(garbled.map((f) => f.result)).toEqual(["inconclusive"]);
});

test("the longest bootstrap suffix wins", () => {
  const bootstrap = {
    services: [
      [["uk"], ["https://a.example/"]],
      [["co.uk"], ["https://b.example"]],
    ],
  };
  expect(bootstrapBase(bootstrap, "shop.co.uk")).toBe("https://b.example/");
  expect(bootstrapBase(bootstrap, "bbc.uk")).toBe("https://a.example/");
});
