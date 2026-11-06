// Ring 3 (adapter): DNS records (SOA, MX, NS, DMARC) over Google's DNS-over-HTTPS JSON API.
import { mergeEntities, type Entity, type EntityOf, type Finding } from "@supah-osint/core";
import type { Source, SourceContext } from "@supah-osint/engine";
import {
  dmarcEmails,
  hostOf,
  linkEmails,
  linkSubdomains,
  readAnswer,
  soaEmail,
  type Extracted,
  type RecordType,
} from "./parse.ts";

export type DnsSourceOptions = { now?: () => number };

const ID = "dns";

export function dnsQueryUrl(name: string, type: RecordType): string {
  return `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`;
}

type Query = {
  name: (domain: string) => string;
  type: RecordType;
  extract: (domain: EntityOf<"Domain">, data: string[]) => Extracted;
};

const QUERIES: readonly Query[] = [
  {
    name: (d) => d,
    type: "SOA",
    extract: (domain, data) =>
      linkEmails(
        domain,
        data.flatMap((row) => soaEmail(row) ?? []),
      ),
  },
  {
    name: (d) => d,
    type: "MX",
    extract: (domain, data) =>
      linkSubdomains(
        domain,
        data.flatMap((row) => hostOf("MX", row) ?? []),
      ),
  },
  {
    name: (d) => d,
    type: "NS",
    extract: (domain, data) =>
      linkSubdomains(
        domain,
        data.flatMap((row) => hostOf("NS", row) ?? []),
      ),
  },
  { name: (d) => `_dmarc.${d}`, type: "TXT", extract: (domain, data) => linkEmails(domain, data.flatMap(dmarcEmails)) },
];

export function dnsSource(options: DnsSourceOptions = {}): Source {
  const now = options.now ?? Date.now;
  return {
    id: ID,
    accepts: ["Domain"],
    keyRequirement: "none",
    async *run(input: Entity, ctx: SourceContext): AsyncIterable<Finding> {
      if (input.type !== "Domain") return;
      for (const query of QUERIES) {
        const url = dnsQueryUrl(query.name(input.key), query.type);
        const base = { auditId: ctx.audit.id, source: ID, url, foundAt: now(), confidence: 1 };
        const response = await ctx.http.get(url, { signal: ctx.signal });
        if (response.status !== 200) {
          yield {
            ...base,
            result: "inconclusive",
            reason: `dns.google answered HTTP ${response.status}`,
            entities: [],
            relations: [],
          };
          continue;
        }
        const answer = readAnswer(response.body, query.type);
        if (answer.kind === "failed") {
          yield { ...base, result: "inconclusive", reason: answer.reason, entities: [], relations: [] };
          continue;
        }
        const found = answer.kind === "records" ? query.extract(input, answer.data) : { entities: [], relations: [] };
        if (found.relations.length === 0) {
          yield { ...base, result: "not_found", reason: null, entities: [], relations: [] };
          continue;
        }
        yield {
          ...base,
          result: "found",
          reason: null,
          entities: mergeEntities([input, ...found.entities]),
          relations: found.relations,
        };
      }
    },
  };
}
