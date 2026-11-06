import { expect, test } from "bun:test";
import { entityId } from "../../packages/core/src/index.ts";
import { dnsSource } from "../../packages/sources/dns/src/index.ts";
import { dmarcEmails, soaEmail } from "../../packages/sources/dns/src/parse.ts";
import { dnsUrl, domain, effRoutes, fixtureHttp, keysOf, runSource } from "./fixture-http.ts";

const DNS = "packages/sources/dns/fixtures";
const source = dnsSource({ now: () => 42 });

test("turns SOA and DMARC addresses into emails and in-domain name servers into subdomains", async () => {
  const eff = domain("eff.org");
  const findings = await runSource(source, eff, fixtureHttp(effRoutes));
  const byUrl = new Map(findings.map((finding) => [finding.url, finding]));
  expect(findings).toHaveLength(4);
  expect(findings.every((finding) => finding.source === "dns" && finding.foundAt === 42)).toBe(true);

  const soa = byUrl.get(dnsUrl("eff.org", "SOA"));
  expect(soa?.result).toBe("found");
  expect(keysOf(soa, "Email")).toEqual(["hostmaster@eff.org"]);
  expect(soa?.relations.map((r) => [r.from, r.label, r.to])).toEqual([
    [entityId(eff), "has_email", "audit-1|Email|hostmaster@eff.org"],
  ]);

  const dmarc = byUrl.get(dnsUrl("_dmarc.eff.org", "TXT"));
  expect(keysOf(dmarc, "Email")).toEqual(["dmarc_rua@eff.org", "dmarc_ruf@eff.org"]);

  const ns = byUrl.get(dnsUrl("eff.org", "NS"));
  expect(keysOf(ns, "Domain")).toEqual(["eff.org", "ns2.eff.org", "ns3.eff.org"]);
  expect(ns?.relations.every((r) => r.label === "subdomain_of" && r.to === entityId(eff))).toBe(true);

  // The mail host belongs to Microsoft, so it stays out of the graph.
  expect(byUrl.get(dnsUrl("eff.org", "MX"))?.result).toBe("not_found");
});

test("third-party mail and name servers never become entities", async () => {
  const routes = {
    [dnsUrl("wikipedia.org", "SOA")]: `${DNS}/wikipedia-soa.json`,
    [dnsUrl("wikipedia.org", "MX")]: `${DNS}/wikipedia-mx.json`,
    [dnsUrl("wikipedia.org", "NS")]: `${DNS}/wikipedia-ns.json`,
    [dnsUrl("_dmarc.wikipedia.org", "TXT")]: `${DNS}/wikipedia-dmarc.json`,
  };
  const findings = await runSource(source, domain("wikipedia.org"), fixtureHttp(routes));
  expect(findings.map((finding) => finding.result)).toEqual(["found", "not_found", "not_found", "found"]);
  expect(keysOf(findings[0], "Email")).toEqual(["hostmaster@wikimedia.org"]);
  expect(findings.flatMap((finding) => keysOf(finding, "Domain"))).toEqual(["wikipedia.org", "wikipedia.org"]);
});

test("NXDOMAIN is not found, but SERVFAIL, HTTP errors and bad JSON are inconclusive", async () => {
  const name = "no-such-domain-xyz123abc.org";
  const nx = Object.fromEntries(
    [dnsUrl(name, "SOA"), dnsUrl(name, "MX"), dnsUrl(name, "NS"), dnsUrl(`_dmarc.${name}`, "TXT")].map((url) => [
      url,
      `${DNS}/nxdomain-soa.json`,
    ]),
  );
  expect((await runSource(source, domain(name), fixtureHttp(nx))).map((f) => f.result)).toEqual(
    Array(4).fill("not_found"),
  );

  const bad = "dnssec-failed.org";
  const routes = {
    [dnsUrl(bad, "SOA")]: `${DNS}/servfail-soa.json`,
    [dnsUrl(bad, "MX")]: { file: `${DNS}/servfail-soa.json`, status: 502 },
    [dnsUrl(bad, "NS")]: "packages/sources/crtsh/fixtures/malformed.json",
    [dnsUrl(`_dmarc.${bad}`, "TXT")]: `${DNS}/servfail-soa.json`,
  };
  const findings = await runSource(source, domain(bad), fixtureHttp(routes));
  expect(findings.map((f) => f.result)).toEqual(Array(4).fill("inconclusive"));
  expect(findings.map((f) => f.reason)).toEqual([
    "DNS lookup failed (SERVFAIL)",
    "dns.google answered HTTP 502",
    "DNS answer was not valid JSON",
    "DNS lookup failed (SERVFAIL)",
  ]);
});

test("reads escaped SOA mailboxes and only mailto DMARC report addresses", () => {
  expect(soaEmail(String.raw`ns1.example.com. john\.doe.example.com. 1 2 3 4 5`)).toBe("john.doe@example.com");
  expect(
    dmarcEmails("v=DMARC1; p=none; rua=mailto:a@example.com!10m,https://r.example/x; ruf=mailto:b@example.com"),
  ).toEqual(["a@example.com", "b@example.com"]);
  expect(dmarcEmails("v=spf1 include:example.com ~all")).toEqual([]);
});

test("skips a DMARC address with a malformed percent code instead of throwing", () => {
  expect(dmarcEmails("v=DMARC1; rua=mailto:a%zz@example.com,mailto:b%40x@example.com")).toEqual(["b@x@example.com"]);
});
