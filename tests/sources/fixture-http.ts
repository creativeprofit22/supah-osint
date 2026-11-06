import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createEntity,
  createFinding,
  type Audit,
  type Entity,
  type EntityOf,
  type Finding,
} from "../../packages/core/src/index.ts";
import type { Http, Source } from "../../packages/engine/src/index.ts";
import { dnsQueryUrl } from "../../packages/sources/dns/src/index.ts";

const ROOT = join(import.meta.dir, "..", "..");

export type Route = string | { file: string; status: number };

// Exact URL -> recorded file (repo-relative); an unknown URL throws so tests can never reach the network.
export function fixtureHttp(routes: Readonly<Record<string, Route>>): Http & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async get(url) {
      calls.push(url);
      const route = routes[url];
      if (route === undefined) throw new Error(`no fixture for ${url}`);
      const { file, status } = typeof route === "string" ? { file: route, status: 200 } : route;
      return { status, body: readFileSync(join(ROOT, file), "utf8") };
    },
  };
}

const DNS = "packages/sources/dns/fixtures";
const RDAP = "packages/sources/rdap/fixtures";
const CRTSH = "packages/sources/crtsh/fixtures";

// dns.test.ts imports this name; it is the source's own helper so fixture URLs cannot drift.
export const dnsUrl = dnsQueryUrl;

// Every lookup the three domain sources make for eff.org, recorded once from the live services.
export const effRoutes: Readonly<Record<string, Route>> = {
  [dnsQueryUrl("eff.org", "SOA")]: `${DNS}/eff-soa.json`,
  [dnsQueryUrl("eff.org", "MX")]: `${DNS}/eff-mx.json`,
  [dnsQueryUrl("eff.org", "NS")]: `${DNS}/eff-ns.json`,
  [dnsQueryUrl("_dmarc.eff.org", "TXT")]: `${DNS}/eff-dmarc.json`,
  "https://data.iana.org/rdap/dns.json": `${RDAP}/iana-bootstrap.json`,
  "https://rdap.publicinterestregistry.org/rdap/domain/eff.org": `${RDAP}/eff-registry.json`,
  "https://rdap.gandi.net/domain/eff.org": `${RDAP}/eff-registrar.json`,
  "https://crt.sh/?q=%25.eff.org&output=json": `${CRTSH}/eff.json`,
};

export const audit: Audit = { id: "audit-1", subjectName: "Ada Lovelace" };

export function domain(name: string): EntityOf<"Domain"> {
  const made = createEntity(audit.id, "Domain", { name });
  if (!made.ok) throw new Error(made.error);
  return made.value;
}

export function username(name: string): EntityOf<"Username"> {
  const made = createEntity(audit.id, "Username", { name });
  if (!made.ok) throw new Error(made.error);
  return made.value;
}

// Runs one source directly and checks every finding obeys the core Finding rules.
export async function runSource(source: Source, input: Entity, http: Http): Promise<Finding[]> {
  const findings: Finding[] = [];
  const ctx = { audit, http, signal: new AbortController().signal, key: null };
  for await (const finding of source.run(input, ctx)) {
    const checked = createFinding(finding);
    if (!checked.ok) throw new Error(`invalid finding from ${source.id}: ${checked.error}`);
    findings.push(finding);
  }
  return findings;
}

export function keysOf(finding: Finding | undefined, type: string): string[] {
  return (finding?.entities ?? [])
    .filter((entity) => entity.type === type)
    .map((entity) => entity.key)
    .sort();
}
