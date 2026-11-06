// Ring 3 (adapter): known data breaches an email appears in, via Have I Been Pwned (needs the user's API key).
import { createEntity, createRelation, type Entity, type EntityOf, type Finding } from "@supah-osint/core";
import type { Source, SourceContext } from "@supah-osint/engine";
import { parseBreaches, type ParsedBreach } from "./parse.ts";

export { parseBreaches, type ParsedBreach } from "./parse.ts";

export type HibpSourceOptions = { now?: () => number };

const ID = "hibp";
const API = "https://haveibeenpwned.com/api/v3";

export function hibpAccountUrl(email: string): string {
  return `${API}/breachedaccount/${encodeURIComponent(email)}?truncateResponse=false`;
}

// The fragment is never sent; it keeps the same breach for two emails in separate finding slots.
export function hibpBreachUrl(name: string, email: string): string {
  return `${API}/breach/${encodeURIComponent(name)}#${encodeURIComponent(email)}`;
}

const STATUS_REASONS: Readonly<Record<number, string>> = {
  400: "Have I Been Pwned could not read the email address (HTTP 400)",
  401: "Have I Been Pwned rejected the API key (HTTP 401)",
  403: "Have I Been Pwned refused the request (HTTP 403)",
  429: "rate limited by Have I Been Pwned (HTTP 429)",
};

export function hibpSource(options: HibpSourceOptions = {}): Source {
  const now = options.now ?? Date.now;
  return {
    id: ID,
    accepts: ["Email"],
    keyRequirement: "required",
    // The lowest paid HIBP plan allows 10 lookups a minute.
    rateLimit: { requests: 10, perMs: 60_000 },
    async *run(input: Entity, ctx: SourceContext): AsyncIterable<Finding> {
      if (input.type !== "Email") return;
      const url = hibpAccountUrl(input.key);
      const base = { auditId: ctx.audit.id, source: ID, confidence: 1 };
      const unclear = (reason: string): Finding => ({
        ...base,
        url,
        foundAt: now(),
        result: "inconclusive",
        reason,
        entities: [],
        relations: [],
      });
      const notFound = (): Finding => ({
        ...base,
        url,
        foundAt: now(),
        result: "not_found",
        reason: null,
        entities: [],
        relations: [],
      });
      // The key travels only in this header, never in the URL or a reason.
      const headers = { "hibp-api-key": ctx.key ?? "", "user-agent": "supah-osint" };
      const response = await ctx.http.get(url, { signal: ctx.signal, headers });
      if (response.status === 404) {
        yield notFound();
        return;
      }
      if (response.status !== 200) {
        yield unclear(STATUS_REASONS[response.status] ?? `Have I Been Pwned answered HTTP ${response.status}`);
        return;
      }
      const breaches = parseBreaches(response.body);
      if (breaches === null) {
        yield unclear("Have I Been Pwned answer was not a readable breach list");
        return;
      }
      if (breaches.length === 0) {
        yield notFound();
        return;
      }
      for (const breach of breaches) {
        const finding = breachFinding(input, breach, base, now());
        yield finding ?? unclear(`could not record the breach "${breach.name}"`);
      }
    },
  };
}

function breachFinding(
  email: EntityOf<"Email">,
  parsed: ParsedBreach,
  base: { auditId: string; source: string; confidence: number },
  foundAt: number,
): Finding | null {
  const breach = createEntity(email.auditId, "Breach", parsed);
  if (!breach.ok) return null;
  const edge = createRelation("exposed_in", email, breach.value);
  if (!edge.ok) return null;
  return {
    ...base,
    url: hibpBreachUrl(breach.value.props.name, email.key),
    foundAt,
    result: "found",
    reason: null,
    entities: [email, breach.value],
    relations: [edge.value],
  };
}
