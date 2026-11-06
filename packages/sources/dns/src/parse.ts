// Pure parsing of dns.google JSON answers into core entities and edges.
import { createEntity, createRelation, type Entity, type EntityOf, type Relation } from "@supah-osint/core";

export type RecordType = "SOA" | "MX" | "NS" | "TXT";

const TYPE_CODES: Record<RecordType, number> = { SOA: 6, MX: 15, NS: 2, TXT: 16 };

export type DnsAnswer =
  | { kind: "records"; data: string[] }
  | { kind: "none" }
  | { kind: "failed"; reason: string };

export type Extracted = { entities: Entity[]; relations: Relation[] };

// Status 0 = NOERROR, 3 = NXDOMAIN; anything else (SERVFAIL, REFUSED, ...) means the lookup itself failed.
export function readAnswer(body: string, type: RecordType): DnsAnswer {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { kind: "failed", reason: "DNS answer was not valid JSON" };
  }
  if (typeof parsed !== "object" || parsed === null || typeof (parsed as { Status?: unknown }).Status !== "number") {
    return { kind: "failed", reason: "DNS answer had no status" };
  }
  const { Status: status, Answer: answer } = parsed as { Status: number; Answer?: unknown };
  if (status === 3) return { kind: "none" };
  if (status !== 0) return { kind: "failed", reason: `DNS lookup failed (${rcodeName(status)})` };
  const data = (Array.isArray(answer) ? answer : [])
    .filter((row): row is { type: number; data: string } => typeof row?.data === "string" && row.type === TYPE_CODES[type])
    .map((row) => row.data);
  return data.length > 0 ? { kind: "records", data } : { kind: "none" };
}

function rcodeName(status: number): string {
  const names: Record<number, string> = { 1: "FORMERR", 2: "SERVFAIL", 4: "NOTIMP", 5: "REFUSED" };
  return names[status] ?? `status ${status}`;
}

// SOA RNAME: the first unescaped dot is the "@" (hostmaster.example.com. -> hostmaster@example.com).
export function soaEmail(data: string): string | null {
  const rname = data.trim().split(/\s+/)[1];
  if (!rname) return null;
  const match = /^((?:[^.\\]|\\.)+)\.(.+?)\.?$/.exec(rname);
  if (!match?.[1] || !match[2]) return null;
  return `${match[1].replace(/\\(.)/g, "$1")}@${match[2]}`;
}

// rua/ruf hold comma-separated URIs; only mailto: ones name an address. "!10m" is a size limit.
export function dmarcEmails(data: string): string[] {
  const text = data.replace(/"\s*"/g, "").replace(/^"|"$/g, "");
  if (!/^\s*v=DMARC1/i.test(text)) return [];
  const out: string[] = [];
  for (const tag of text.split(";")) {
    const [name, value] = tag.split("=").map((part) => part.trim());
    if (!value || !name || !/^ru[af]$/i.test(name)) continue;
    for (const uri of value.split(",")) {
      const address = /^mailto:([^!\s]+)/i.exec(uri.trim())?.[1];
      if (!address) continue;
      // Record text is remote data; a bad percent code drops that address, not the whole lookup.
      try {
        out.push(decodeURIComponent(address));
      } catch {}
    }
  }
  return out;
}

// MX data is "priority host."; NS data is "host.".
export function hostOf(type: "MX" | "NS", data: string): string | null {
  const parts = data.trim().split(/\s+/);
  return (type === "MX" ? parts[1] : parts[0]) ?? null;
}

export function linkEmails(domain: EntityOf<"Domain">, addresses: readonly string[]): Extracted {
  const entities: Entity[] = [];
  const relations: Relation[] = [];
  for (const address of addresses) {
    const email = createEntity(domain.auditId, "Email", { address });
    if (!email.ok) continue;
    const edge = createRelation("has_email", domain, email.value);
    if (!edge.ok) continue;
    entities.push(email.value);
    relations.push(edge.value);
  }
  return { entities, relations };
}

// Only hosts inside the audited domain; third-party mail or DNS providers stay out of scope.
export function linkSubdomains(domain: EntityOf<"Domain">, hosts: readonly string[]): Extracted {
  const entities: Entity[] = [];
  const relations: Relation[] = [];
  for (const host of hosts) {
    const sub = createEntity(domain.auditId, "Domain", { name: host });
    if (!sub.ok || sub.value.key === domain.key || !sub.value.key.endsWith(`.${domain.key}`)) continue;
    const edge = createRelation("subdomain_of", sub.value, domain);
    if (!edge.ok) continue;
    entities.push(sub.value);
    relations.push(edge.value);
  }
  return { entities, relations };
}
