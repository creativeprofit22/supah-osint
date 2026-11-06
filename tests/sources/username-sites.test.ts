import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { entityId, type Finding, type Result } from "../../packages/core/src/index.ts";
import type { Http, HttpRequestOptions } from "../../packages/engine/src/index.ts";
import {
  bundledSiteList,
  fillTemplate,
  parseSiteList,
  readSiteListFile,
  siteRequest,
  usableSites,
  usernameSitesSource,
  type Site,
} from "../../packages/sources/username-sites/src/index.ts";
import { audit, domain, fixtureHttp, runSource, username, type Route } from "./fixture-http.ts";

const ROOT = join(import.meta.dir, "..", "..");
const DIR = "packages/sources/username-sites/fixtures";
const PROFILE = `${DIR}/profile.html`;
const MISSING = `${DIR}/missing.html`;
const NAME = "Ada.Love+lace";

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

const read = (file: string) => readFileSync(join(ROOT, file), "utf8");
const testSites = value(parseSiteList(read(`${DIR}/test-sites.json`))).sites;

function site(name: string): Site {
  const found = testSites.find((s) => s.name === name);
  if (!found) throw new Error(`no test site ${name}`);
  return found;
}

// Checks NAME on one test site whose check URL answers with `route`.
async function checkOne(name: string, route: Route): Promise<Finding> {
  const only = site(name);
  const url = fillTemplate(only.uriCheck, only, NAME);
  const findings = await runSource(
    usernameSitesSource({ sites: [only], now: () => 7 }),
    username(NAME),
    fixtureHttp({ [url]: route }),
  );
  expect(findings).toHaveLength(1);
  return findings[0] as Finding;
}

const verdict = (finding: Finding) => [finding.result, finding.reason];

test("status and text both matching the found signal is found, with account, profile URL and edges", async () => {
  const finding = await checkOne("Alpha", PROFILE);
  expect(finding.result).toBe("found");
  expect(finding.url).toBe("https://alpha.example/users/Ada.Love%2Blace");
  expect(finding.confidence).toBe(0.6);
  expect(finding.foundAt).toBe(7);
  const [handle, account, profile] = finding.entities;
  expect(handle?.type).toBe("Username");
  expect(account).toMatchObject({
    type: "Account",
    key: "alpha:ada.love+lace",
    props: { service: "Alpha", username: NAME },
  });
  expect(profile).toMatchObject({ type: "Url", props: { href: "https://alpha.example/@Ada.Love%2Blace" } });
  if (!handle || !account || !profile) throw new Error("missing entities");
  expect(finding.relations.map((r) => [r.label, r.from, r.to])).toEqual([
    ["has_username", entityId(account), entityId(handle)],
    ["has_url", entityId(account), entityId(profile)],
  ]);
});

test("not found by status code alone", async () => {
  expect(verdict(await checkOne("Alpha", { file: MISSING, status: 404 }))).toEqual(["not_found", null]);
});

test("not found by status code and not-found text", async () => {
  expect(verdict(await checkOne("Beta", MISSING))).toEqual(["not_found", null]);
});

test("found status without the profile text is inconclusive, not found", async () => {
  expect(verdict(await checkOne("Alpha", `${DIR}/generic-200.html`))).toEqual([
    "inconclusive",
    "Alpha: HTTP 200 but the expected profile text was missing",
  ]);
});

test("an empty not-found text with the same status as found never means not found", async () => {
  expect(verdict(await checkOne("Samecode", PROFILE))).toEqual(["found", null]);
  expect(verdict(await checkOne("Samecode", `${DIR}/generic-200.html`))).toEqual([
    "inconclusive",
    "Samecode: HTTP 200 but the expected profile text was missing",
  ]);
});

test("not-found status without the not-found text is inconclusive", async () => {
  const beta = site("Beta");
  const odd = { ...beta, eCode: 201 };
  const url = fillTemplate(odd.uriCheck, odd, NAME);
  const http = fixtureHttp({ [url]: `${DIR}/generic-200.html` });
  const [finding] = await runSource(usernameSitesSource({ sites: [odd] }), username(NAME), http);
  expect(finding && verdict(finding)).toEqual([
    "inconclusive",
    "Beta: HTTP 200 but the expected not-found text was missing",
  ]);
});

test("a page matching both signals is inconclusive", async () => {
  expect(verdict(await checkOne("Beta", `${DIR}/both-signals.html`))).toEqual([
    "inconclusive",
    "Beta: HTTP 200 matched both the found and not-found signals",
  ]);
});

test("an unexpected status is inconclusive", async () => {
  expect(verdict(await checkOne("Alpha", { file: `${DIR}/forbidden.html`, status: 403 }))).toEqual([
    "inconclusive",
    "Alpha: unexpected HTTP 403",
  ]);
});

test("a failed request makes only that site inconclusive", async () => {
  const sites = [site("Alpha"), site("Beta"), site("Gamma")];
  const routes = {
    [fillTemplate(site("Alpha").uriCheck, site("Alpha"), NAME)]: PROFILE,
    [fillTemplate(site("Gamma").uriCheck, site("Gamma"), NAME)]: { file: MISSING, status: 404 },
  };
  const findings = await runSource(usernameSitesSource({ sites }), username(NAME), fixtureHttp(routes));
  const byUrl = Object.fromEntries(findings.map((f) => [f.url, f.result]));
  expect(byUrl).toEqual({
    "https://alpha.example/users/Ada.Love%2Blace": "found",
    "https://beta.example/Ada.Love%2Blace": "inconclusive",
    "https://gamma.example/api?user=AdaLove%2Blace": "not_found",
  });
  const beta = findings.find((f) => f.url?.startsWith("https://beta."));
  expect(beta?.reason).toBe("Beta: request failed: no fixture for https://beta.example/Ada.Love%2Blace");
});

test("skips only sites the list marks broken; adult sites are on unless turned off", () => {
  const all = ["Alpha", "Beta", "Gamma", "Poster", "Header", "Adult", "Jsonpost", "Redirector", "Samecode"];
  expect(usableSites(testSites).map((s) => s.name)).toEqual(all);
  expect(usableSites(testSites, false).map((s) => s.name)).toEqual(all.filter((name) => name !== "Adult"));
  expect(usernameSitesSource({ sites: testSites, includeNsfw: false }).accepts).toEqual(["Username"]);
});

// Answers every request with one status and body, and records what was sent.
function recording(status: number, body = "") {
  const requests: { url: string; options: HttpRequestOptions | undefined }[] = [];
  const http: Http = {
    async get(url, options) {
      requests.push({ url, options });
      return { status, body };
    },
  };
  return { http, requests };
}

test("every check is sent without following redirects, with the site's own headers", async () => {
  const { http, requests } = recording(404);
  await runSource(usernameSitesSource({ sites: [site("Header")] }), username(NAME), http);
  expect(requests).toHaveLength(1);
  expect(requests[0]?.url).toBe("https://header.example/Ada.Love%2Blace");
  expect(requests[0]?.options).toMatchObject({
    method: "GET",
    redirect: "manual",
    headers: { Accept: "application/json" },
  });
});

test("a redirect that signals a missing user is not found", async () => {
  const [finding] = await runSource(
    usernameSitesSource({ sites: [site("Redirector")] }),
    username(NAME),
    recording(302).http,
  );
  expect(finding && verdict(finding)).toEqual(["not_found", null]);
});

test("a JSON POST check escapes the username inside the body and points the finding at the profile page", async () => {
  const quoted = 'Ada"Love';
  const { http, requests } = recording(200, '{"taken":true}');
  const [finding] = await runSource(usernameSitesSource({ sites: [site("Jsonpost")] }), username(quoted), http);
  expect(requests[0]?.url).toBe("https://jsonpost.example/api/check");
  expect(requests[0]?.options).toMatchObject({
    method: "POST",
    body: '{"username":"Ada\\"Love"}',
    headers: { "Content-Type": "application/json" },
  });
  expect(JSON.parse(requests[0]?.options?.body ?? "")).toEqual({ username: quoted });
  expect(finding?.result).toBe("found");
  expect(finding?.url).toBe("https://jsonpost.example/u/Ada%22Love");
  expect(finding?.entities.map((e) => e.type)).toEqual(["Username", "Account", "Url"]);
  const missing = await runSource(
    usernameSitesSource({ sites: [site("Jsonpost")] }),
    username(NAME),
    recording(200, '{"taken":false}').http,
  );
  expect(missing.map(verdict)).toEqual([["not_found", null]]);
});

test("a form POST check URL-encodes the username; with no per-user address the finding stays per username", async () => {
  const request = siteRequest(site("Poster"), NAME);
  expect(request.options).toMatchObject({ method: "POST", body: '{"user":"Ada.Love%2Blace"}' });
  expect(request.profileUrl).toBeNull();
  expect(request.findingUrl).toBe("https://poster.example/api/lookup#Ada.Love%2Blace");
  expect(siteRequest(site("Poster"), "other").findingUrl).not.toBe(request.findingUrl);
  const [finding] = await runSource(
    usernameSitesSource({ sites: [site("Poster")] }),
    username(NAME),
    recording(200, "profile-card").http,
  );
  expect(finding?.result).toBe("found");
  expect(finding?.entities.map((e) => e.type)).toEqual(["Username", "Account"]);
  expect(finding?.relations.map((r) => r.label)).toEqual(["has_username"]);
});

test("accounts found on adult sites are labelled adult; others are not", async () => {
  const sites = [site("Adult"), site("Alpha")];
  const findings = await runSource(usernameSitesSource({ sites }), username(NAME), recording(200, "profile-card").http);
  const accounts = findings.flatMap((f) => f.entities).filter((e) => e.type === "Account");
  expect(accounts.map((a) => [a.props.service, "adult" in a.props && a.props.adult])).toEqual([
    ["Adult", true],
    ["Alpha", false],
  ]);
  const off = await runSource(usernameSitesSource({ sites, includeNsfw: false }), username(NAME), recording(404).http);
  expect(off.map((f) => f.url)).toEqual(["https://alpha.example/users/Ada.Love%2Blace"]);
});

test("strips bad characters, then URL-encodes the username", () => {
  expect(fillTemplate(site("Gamma").uriCheck, site("Gamma"), NAME)).toBe(
    "https://gamma.example/api?user=AdaLove%2Blace",
  );
  expect(fillTemplate(site("Alpha").uriCheck, site("Alpha"), "a/b?c")).toBe("https://alpha.example/users/a%2Fb%3Fc");
});

test("only checks the usable sites and never more than `concurrency` at once", async () => {
  let inFlight = 0;
  let peak = 0;
  const calls: string[] = [];
  const http: Http = {
    async get(url) {
      calls.push(url);
      inFlight++;
      peak = Math.max(peak, inFlight);
      await Bun.sleep(5);
      inFlight--;
      return { status: 404, body: "" };
    },
  };
  const sites = [
    ...testSites,
    ...testSites.map((s) => ({ ...s, uriCheck: s.uriCheck.replace("example", "example2") })),
  ];
  const findings = await runSource(usernameSitesSource({ sites, concurrency: 2 }), username(NAME), http);
  expect(calls).toHaveLength(18);
  expect(findings).toHaveLength(18);
  expect(peak).toBe(2);
});

test("stops when the audit is cancelled", async () => {
  const controller = new AbortController();
  controller.abort();
  const source = usernameSitesSource({ sites: testSites });
  const http = fixtureHttp({});
  const findings: Finding[] = [];
  for await (const finding of source.run(username(NAME), { audit, http, signal: controller.signal, key: null })) {
    findings.push(finding);
  }
  expect(findings).toEqual([]);
});

test("ignores inputs that are not usernames", async () => {
  const source = usernameSitesSource({ sites: testSites });
  expect(await runSource(source, domain("eff.org"), fixtureHttp({}))).toEqual([]);
});

test("a site list rejects bad entries one by one and keeps the good ones", () => {
  expect(parseSiteList("{ not json")).toEqual({ ok: false, error: "site list is not valid JSON" });
  expect(parseSiteList('{"sites": 3}')).toEqual({ ok: false, error: "site list has no sites array" });
  const list = value(parseSiteList(read(`${DIR}/bad-sites.json`)));
  expect(list.sites.map((s) => s.name)).toEqual(["Good"]);
  expect(list.rejected).toEqual([
    { index: 0, reason: "entry is not an object" },
    { index: 1, reason: "NoPlaceholder: uri_check has no {account} placeholder" },
    { index: 2, reason: "StringCode: e_code and m_code must be HTTP status numbers" },
    { index: 3, reason: "Ftp: uri_check is not an http(s) URL" },
    { index: 4, reason: "Same: found and not-found signals are identical" },
  ]);
});

test("an updated site list can be read from disk, and a missing file fails cleanly", async () => {
  const dir = mkdtempSync(join(tmpdir(), "username-sites-"));
  const path = join(dir, "sites.json");
  writeFileSync(path, read(`${DIR}/test-sites.json`));
  expect(value(await readSiteListFile(path)).sites).toHaveLength(10);
  const missing = await readSiteListFile(join(dir, "nope.json"));
  expect(missing.ok).toBe(false);
  if (!missing.ok) expect(missing.error).toStartWith("could not read site list");
});

test("the bundled WhatsMyName list loads hundreds of usable sites and keeps its CC BY-SA licence", () => {
  const list = bundledSiteList();
  expect(list.rejected).toEqual([]);
  expect(usableSites(list.sites).length).toBeGreaterThan(500);
  const raw = JSON.parse(read("packages/sources/username-sites/data/wmn-data.json")) as { license: string[] };
  expect(raw.license.join(" ")).toContain("Creative Commons Attribution-ShareAlike");
  expect(read("packages/sources/username-sites/data/LICENSE.md")).toContain("CC BY-SA 4.0");
});

test("declares a rate limit so the guard throttles every site check", () => {
  const source = usernameSitesSource({ sites: testSites });
  expect(source.rateLimit).toEqual({ requests: 4, perMs: 1000 });
  expect(source.accepts).toEqual(["Username"]);
  expect(source.keyRequirement).toBe("none");
});
