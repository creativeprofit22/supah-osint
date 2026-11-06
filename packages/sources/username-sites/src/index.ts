// Ring 3 (adapter): checks one username across many sites, driven by a WhatsMyName-style data file.
import {
  createEntity,
  createRelation,
  type Entity,
  type EntityOf,
  type Finding,
  type Relation,
} from "@supah-osint/core";
import type { HttpRequestOptions, Source, SourceContext } from "@supah-osint/engine";
import { classify } from "./check.ts";
import { bundledSiteList, NSFW_CATEGORY, type Site } from "./sites.ts";

export { classify, type Verdict } from "./check.ts";
export * from "./sites.ts";

export type UsernameSitesOptions = {
  sites?: readonly Site[];
  // On by default; adult hits are labelled on the Account (adult: true).
  includeNsfw?: boolean;
  concurrency?: number;
  now?: () => number;
};

export type SiteRequest = {
  url: string;
  options: HttpRequestOptions;
  // Unique per username, so each answer gets its own finding slot.
  findingUrl: string;
  // null when no address on the site carries the username.
  profileUrl: string | null;
};

const ID = "username-sites";
// The same handle on a site can belong to someone else.
const CONFIDENCE = 0.6;

export const isAdult = (site: Site): boolean => site.category === NSFW_CATEGORY;

export function usableSites(sites: readonly Site[], includeNsfw = true): Site[] {
  return sites.filter((site) => site.valid && (includeNsfw || !isAdult(site)));
}

const stripped = (site: Site, username: string): string =>
  [...site.stripBadChar].reduce((name, bad) => name.replaceAll(bad, ""), username);

export function fillTemplate(template: string, site: Site, username: string): string {
  return template.replaceAll("{account}", encodeURIComponent(stripped(site, username)));
}

function fillBody(site: Site, body: string, username: string): string {
  const name = stripped(site, username);
  const type = Object.entries(site.headers).find(([key]) => key.toLowerCase() === "content-type")?.[1] ?? "";
  // Inside JSON the name must be string-escaped; in form bodies it must be URL-encoded.
  const filled = type.includes("json") ? JSON.stringify(name).slice(1, -1) : encodeURIComponent(name);
  return body.replaceAll("{account}", filled);
}

export function siteRequest(site: Site, username: string): SiteRequest {
  const url = fillTemplate(site.uriCheck, site, username);
  const pretty = [site.uriPretty, site.uriCheck].find((template) => template?.includes("{account}"));
  const profileUrl = pretty ? fillTemplate(pretty, site, username) : null;
  const options: HttpRequestOptions =
    site.postBody === null
      ? { method: "GET", headers: site.headers, redirect: "manual" }
      : { method: "POST", headers: site.headers, redirect: "manual", body: fillBody(site, site.postBody, username) };
  // The fragment is never sent; it only keeps findings for different usernames apart.
  const findingUrl = site.uriCheck.includes("{account}")
    ? url
    : (profileUrl ?? `${url}#${encodeURIComponent(username)}`);
  return { url, options, profileUrl, findingUrl };
}

export function usernameSitesSource(options: UsernameSitesOptions = {}): Source {
  const now = options.now ?? Date.now;
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 4));
  const sites = usableSites(options.sites ?? bundledSiteList().sites, options.includeNsfw ?? true);
  return {
    id: ID,
    accepts: ["Username"],
    keyRequirement: "none",
    // Hundreds of different sites, but one shared limit keeps the whole run polite.
    rateLimit: { requests: 4, perMs: 1000 },
    async *run(input: Entity, ctx: SourceContext): AsyncIterable<Finding> {
      if (input.type !== "Username") return;
      const check = (site: Site) => checkSite(site, input, ctx, now);
      yield* pool(sites, concurrency, check, ctx.signal);
    },
  };
}

async function checkSite(
  site: Site,
  username: EntityOf<"Username">,
  ctx: SourceContext,
  now: () => number,
): Promise<Finding | null> {
  const request = siteRequest(site, username.props.name);
  const base = { auditId: ctx.audit.id, source: ID, url: request.findingUrl, confidence: CONFIDENCE };
  const unclear = (reason: string): Finding => ({
    ...base,
    foundAt: now(),
    result: "inconclusive",
    reason: `${site.name}: ${reason}`,
    entities: [],
    relations: [],
  });
  let verdict: ReturnType<typeof classify>;
  try {
    verdict = classify(site, await ctx.http.get(request.url, { ...request.options, signal: ctx.signal }));
  } catch (error) {
    if (ctx.signal.aborted) return null;
    return unclear(`request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (verdict.result === "inconclusive") return unclear(verdict.reason ?? "unclear answer");
  if (verdict.result === "not_found") {
    return { ...base, foundAt: now(), result: "not_found", reason: null, entities: [], relations: [] };
  }
  const graph = profileGraph(site, username, request.profileUrl);
  if (!graph) return unclear("could not build the account");
  return { ...base, foundAt: now(), result: "found", reason: null, ...graph };
}

function profileGraph(
  site: Site,
  username: EntityOf<"Username">,
  href: string | null,
): { entities: Entity[]; relations: Relation[] } | null {
  const raw = { service: site.name, username: username.props.name, ...(isAdult(site) ? { adult: true } : {}) };
  const account = createEntity(username.auditId, "Account", raw);
  if (!account.ok) return null;
  const linked = createRelation("has_username", account.value, username);
  if (!linked.ok) return null;
  const entities: Entity[] = [username, account.value];
  const relations: Relation[] = [linked.value];
  if (href === null) return { entities, relations };
  const profile = createEntity(username.auditId, "Url", { href });
  const edge = profile.ok ? createRelation("has_url", account.value, profile.value) : null;
  if (profile.ok && edge?.ok) {
    entities.push(profile.value);
    relations.push(edge.value);
  }
  return { entities, relations };
}

// Runs `work` over items with at most `size` in flight, yielding answers as they arrive.
async function* pool<T, R>(
  items: readonly T[],
  size: number,
  work: (item: T) => Promise<R | null>,
  signal: AbortSignal,
): AsyncIterable<R> {
  const running = new Map<number, Promise<[number, R | null]>>();
  let next = 0;
  const start = () => {
    const index = next++;
    const item = items[index] as T;
    running.set(
      index,
      work(item).then((answer): [number, R | null] => [index, answer]),
    );
  };
  while (next < items.length && running.size < size) start();
  while (running.size > 0) {
    if (signal.aborted) return;
    const [index, answer] = await Promise.race(running.values());
    running.delete(index);
    if (next < items.length && !signal.aborted) start();
    if (answer !== null && !signal.aborted) yield answer;
  }
}
