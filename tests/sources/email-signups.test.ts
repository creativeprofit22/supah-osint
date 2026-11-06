import { describe, expect, test } from "bun:test";
import {
  BUNDLED_SIGNUP_SITES,
  emailSignupsSource,
  signupRequest,
  type SignupSite,
} from "../../packages/sources/email-signups/src/index.ts";
import { email, fixtureHttp, keysOf, runSource, type Route } from "./fixture-http.ts";

const DIR = "packages/sources/email-signups/fixtures";
const ADDRESS = "ada@example.com";
const now = () => 1_700_000_000_000;

function site(name: string): SignupSite {
  const found = BUNDLED_SIGNUP_SITES.find((s) => s.name === name);
  if (!found) throw new Error(`no bundled site ${name}`);
  return found;
}

const HF = site("Hugging Face");
const WP = site("WordPress.com");

async function check(target: SignupSite, route: Route, address = ADDRESS) {
  const http = fixtureHttp({ [signupRequest(target, address).url]: route });
  const findings = await runSource(emailSignupsSource({ sites: [target], now }), email(address), http);
  return { findings, http };
}

// "missing" fixtures were recorded live with an example.com address nobody owns; "found",
// rate-limit and unclear answers are hand-written from the user-scanner module strings.
describe("email sign-up checks", () => {
  test("found: an Account with the email, linked by has_email", async () => {
    for (const [target, file] of [
      [HF, "huggingface-found.json"],
      [WP, "wordpress-found.json"],
      [WP, "wordpress-username-only.json"],
    ] as const) {
      const { findings } = await check(target, `${DIR}/${file}`);
      expect(findings).toHaveLength(1);
      const finding = findings[0];
      expect(finding).toMatchObject({ result: "found", source: "email-signups", confidence: 0.9 });
      expect(finding?.reason).toBe(`${target.name} (${target.via}): account exists`);
      expect(keysOf(finding, "Account")).toEqual([`${target.name.toLowerCase()}:${ADDRESS}`]);
      expect(finding?.relations.map((r) => r.label)).toEqual(["has_email"]);
    }
  });

  test("not found (recorded live)", async () => {
    for (const [target, file] of [
      [HF, "huggingface-missing.json"],
      [WP, "wordpress-missing.json"],
    ] as const) {
      const { findings } = await check(target, `${DIR}/${file}`);
      expect(findings.map((f) => f.result)).toEqual(["not_found"]);
      expect(findings[0]?.reason).toBe(`${target.name} (${target.via}): no account`);
    }
  });

  test("rate limited is inconclusive", async () => {
    const { findings } = await check(HF, { file: `${DIR}/rate-limited.json`, status: 429 });
    expect(findings[0]).toMatchObject({
      result: "inconclusive",
      reason: "Hugging Face (sign-up form): rate limited (HTTP 429)",
    });
  });

  test("unclear answers are inconclusive, never not_found", async () => {
    const cases: [Route, string][] = [
      [`${DIR}/unclear.html`, "answer had neither the found nor the not-found text"],
      [`${DIR}/both-texts.json`, "answer matched both the found and not-found text"],
      [{ file: `${DIR}/unclear.html`, status: 503 }, "unexpected HTTP 503"],
      [{ file: `${DIR}/unclear.html`, status: 302 }, "unexpected HTTP 302"],
    ];
    for (const [route, reason] of cases) {
      const { findings } = await check(HF, route);
      expect(findings[0]).toMatchObject({
        result: "inconclusive",
        reason: `Hugging Face (sign-up form): ${reason}`,
        entities: [],
      });
    }
  });

  test("a failed request is inconclusive for that site only", async () => {
    const http = fixtureHttp({ [signupRequest(WP, ADDRESS).url]: `${DIR}/wordpress-missing.json` });
    const findings = await runSource(emailSignupsSource({ sites: [HF, WP], now }), email(ADDRESS), http);
    expect(findings.map((f) => f.result)).toEqual(["inconclusive", "not_found"]);
    expect(findings[0]?.reason).toStartWith("Hugging Face (sign-up form): request failed:");
  });

  test("reasons never carry the email address", async () => {
    const http = fixtureHttp({});
    const findings = await runSource(emailSignupsSource({ sites: [HF, WP], now }), email(ADDRESS), http);
    expect(findings[1]?.reason).toStartWith("WordPress.com (login form): request failed:");
    for (const finding of findings) {
      expect(finding.reason).not.toContain(ADDRESS);
      expect(finding.reason).not.toContain(encodeURIComponent(ADDRESS));
    }
  });

  test("each site and email gets its own finding slot", async () => {
    const http = fixtureHttp({
      [signupRequest(HF, ADDRESS).url]: `${DIR}/huggingface-missing.json`,
      [signupRequest(WP, ADDRESS).url]: `${DIR}/wordpress-missing.json`,
    });
    const findings = await runSource(emailSignupsSource({ sites: [HF, WP], now }), email(ADDRESS), http);
    expect(findings.map((f) => f.url)).toEqual([
      "https://huggingface.co#ada%40example.com",
      "https://wordpress.com#ada%40example.com",
    ]);
    expect(signupRequest(HF, "bob@example.com").findingUrl).not.toBe(signupRequest(HF, ADDRESS).findingUrl);
  });

  test("requests match the ported modules, with the email encoded for each place", async () => {
    const { http } = await check(HF, `${DIR}/huggingface-missing.json`, 'a"b@example.com');
    expect(http.requests[0]?.options).toMatchObject({ method: "POST", redirect: "manual" });
    expect(JSON.parse(http.requests[0]?.options?.body ?? "")).toEqual({ email: 'a"b@example.com' });
    expect(signupRequest(WP, "a+b@example.com").url).toBe(
      "https://public-api.wordpress.com/rest/v1.1/users/a%2Bb%40example.com/auth-options?http_envelope=1",
    );
    expect(signupRequest(WP, ADDRESS).options.method).toBe("GET");
  });

  test("needs no key and only accepts emails", () => {
    const source = emailSignupsSource();
    expect(source.keyRequirement).toBe("none");
    expect(source.accepts).toEqual(["Email"]);
  });
});
