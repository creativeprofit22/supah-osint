// Ring 3 (adapter): asks a few sites' sign-up, login or reset forms whether an email has an account. Opt-in only.
import { createEntity, createRelation, type Entity, type EntityOf, type Finding } from "@supah-osint/core";
import type { HttpRequestOptions, Source, SourceContext } from "@supah-osint/engine";
import { classify } from "./check.ts";
import { BUNDLED_SIGNUP_SITES, type SignupSite } from "./sites.ts";

export { classify, type Verdict } from "./check.ts";
export * from "./sites.ts";

export type EmailSignupsOptions = {
  sites?: readonly SignupSite[];
  now?: () => number;
};

export type SignupRequest = { url: string; options: HttpRequestOptions; findingUrl: string };

const ID = "email-signups";
// The site says the address has an account; it can't say who made it.
const CONFIDENCE = 0.9;

function fillBody(site: SignupSite, body: string, email: string): string {
  const type = Object.entries(site.check.headers).find(([key]) => key.toLowerCase() === "content-type")?.[1] ?? "";
  const filled = type.includes("json") ? JSON.stringify(email).slice(1, -1) : encodeURIComponent(email);
  return body.replaceAll("{email}", filled);
}

export function signupRequest(site: SignupSite, email: string): SignupRequest {
  const url = site.check.url.replaceAll("{email}", encodeURIComponent(email));
  const base = { method: site.check.method, headers: site.check.headers, redirect: "manual" } as const;
  const options: HttpRequestOptions =
    site.check.body === null ? base : { ...base, body: fillBody(site, site.check.body, email) };
  // The fragment is never sent; it gives every site/email pair its own finding slot.
  return { url, options, findingUrl: `${site.url}#${encodeURIComponent(email)}` };
}

export function emailSignupsSource(options: EmailSignupsOptions = {}): Source {
  const now = options.now ?? Date.now;
  const sites = options.sites ?? BUNDLED_SIGNUP_SITES;
  return {
    id: ID,
    accepts: ["Email"],
    keyRequirement: "none",
    rateLimit: { requests: 2, perMs: 1000 },
    async *run(input: Entity, ctx: SourceContext): AsyncIterable<Finding> {
      if (input.type !== "Email") return;
      for (const site of sites) {
        if (ctx.signal.aborted) return;
        const finding = await checkSite(site, input, ctx, now);
        if (finding) yield finding;
      }
    },
  };
}

async function checkSite(
  site: SignupSite,
  email: EntityOf<"Email">,
  ctx: SourceContext,
  now: () => number,
): Promise<Finding | null> {
  const request = signupRequest(site, email.key);
  const base = { auditId: ctx.audit.id, source: ID, url: request.findingUrl, confidence: CONFIDENCE };
  // Names the site and its form on every row so the user knows who was asked and how.
  const label = (text: string) => `${site.name} (${site.via}): ${text}`;
  const unclear = (reason: string): Finding => ({
    ...base,
    foundAt: now(),
    result: "inconclusive",
    reason: label(reason),
    entities: [],
    relations: [],
  });
  let verdict: ReturnType<typeof classify>;
  try {
    verdict = classify(site, await ctx.http.get(request.url, { ...request.options, signal: ctx.signal }));
  } catch (error) {
    if (ctx.signal.aborted) return null;
    const message = error instanceof Error ? error.message : String(error);
    // Error text can echo the request URL, which may hold the address.
    const scrubbed = message.replaceAll(encodeURIComponent(email.key), "<email>").replaceAll(email.key, "<email>");
    return unclear(`request failed: ${scrubbed}`);
  }
  if (verdict.result === "inconclusive") return unclear(verdict.reason ?? "unclear answer");
  if (verdict.result === "not_found") {
    return { ...base, foundAt: now(), result: "not_found", reason: label("no account"), entities: [], relations: [] };
  }
  const account = createEntity(email.auditId, "Account", { service: site.name, username: email.key });
  const edge = account.ok ? createRelation("has_email", account.value, email) : null;
  if (!account.ok || !edge?.ok) return unclear("could not build the account");
  return {
    ...base,
    foundAt: now(),
    result: "found",
    reason: label("account exists"),
    entities: [email, account.value],
    relations: [edge.value],
  };
}
