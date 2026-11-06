// Ring 3 (adapter): subdomains seen in certificate-transparency logs, via crt.sh.
import { type Entity, type Finding } from "@supah-osint/core";
import type { Source, SourceContext } from "@supah-osint/engine";
import { certificateNames, linkSubdomains } from "./parse.ts";

export type CrtshSourceOptions = { now?: () => number };

const ID = "crtsh";

export function crtshQueryUrl(domain: string): string {
  return `https://crt.sh/?q=${encodeURIComponent(`%.${domain}`)}&output=json`;
}

export function crtshSource(options: CrtshSourceOptions = {}): Source {
  const now = options.now ?? Date.now;
  return {
    id: ID,
    accepts: ["Domain"],
    keyRequirement: "none",
    // crt.sh is a free shared service that throttles bursts.
    rateLimit: { requests: 1, perMs: 5000 },
    async *run(input: Entity, ctx: SourceContext): AsyncIterable<Finding> {
      if (input.type !== "Domain") return;
      const url = crtshQueryUrl(input.key);
      // Certificate names can belong to hosts that no longer exist.
      const base = { auditId: ctx.audit.id, source: ID, url, foundAt: now(), confidence: 0.8 };
      const response = await ctx.http.get(url, { signal: ctx.signal });
      if (response.status !== 200) {
        yield { ...base, result: "inconclusive", reason: `crt.sh answered HTTP ${response.status}`, entities: [], relations: [] };
        return;
      }
      const names = certificateNames(response.body);
      if (!names) {
        yield { ...base, result: "inconclusive", reason: "crt.sh answer was not valid JSON", entities: [], relations: [] };
        return;
      }
      const found = linkSubdomains(input, names);
      if (found.relations.length === 0) {
        yield { ...base, result: "not_found", reason: null, entities: [], relations: [] };
        return;
      }
      yield { ...base, result: "found", reason: null, entities: [input, ...found.entities], relations: found.relations };
    },
  };
}
