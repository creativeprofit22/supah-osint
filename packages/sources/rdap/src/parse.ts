// Pure parsing of RDAP JSON (IANA bootstrap and domain records) into core entities and edges.
import {
  createEntity,
  createRelation,
  mergeEntities,
  relationId,
  type Entity,
  type EntityOf,
  type Relation,
} from "@supah-osint/core";

export type Extracted = { entities: Entity[]; relations: Relation[] };

type Json = Record<string, unknown>;

const CONTACT_ROLES = new Set(["registrant", "administrative", "technical"]);
const SKIPPED_ROLES = new Set(["registrar", "abuse"]);
const REDACTED = /redact|privacy|withheld|not disclosed|data protected/i;

export function parseJson(body: string): Json | null {
  try {
    const parsed: unknown = JSON.parse(body);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// RFC 9224: the longest matching label suffix wins; returns the base URL with a trailing slash.
export function bootstrapBase(bootstrap: Json, domain: string): string | null {
  const services = Array.isArray(bootstrap.services) ? bootstrap.services : [];
  let best: { length: number; url: string } | null = null;
  for (const service of services) {
    if (!Array.isArray(service)) continue;
    const [suffixes, urls] = service;
    if (!Array.isArray(suffixes) || !Array.isArray(urls)) continue;
    const url = urls.find((u): u is string => typeof u === "string" && u.startsWith("https://"));
    if (!url) continue;
    for (const suffix of suffixes) {
      if (typeof suffix !== "string") continue;
      const tld = suffix.toLowerCase();
      if ((domain === tld || domain.endsWith(`.${tld}`)) && (!best || tld.length > best.length)) {
        best = { length: tld.length, url: url.endsWith("/") ? url : `${url}/` };
      }
    }
  }
  return best?.url ?? null;
}

// Thin registries (.com, .org) keep contacts at the registrar, linked as rel "related".
export function registrarLink(record: Json): string | null {
  const links = Array.isArray(record.links) ? record.links : [];
  for (const link of links) {
    if (!isObject(link) || link.rel !== "related" || typeof link.href !== "string") continue;
    if (typeof link.type === "string" && !link.type.includes("rdap")) continue;
    if (link.href.startsWith("https://")) return link.href;
  }
  return null;
}

type Contact = { kind: string | null; fn: string | null; org: string | null; emails: string[] };

function visible(value: unknown): string | null {
  if (Array.isArray(value)) value = value.find((part) => typeof part === "string" && part.trim() !== "");
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text === "" || REDACTED.test(text) ? null : text;
}

// jCard: ["vcard", [[name, params, type, value], ...]].
function readVcard(vcardArray: unknown): Contact | null {
  if (!Array.isArray(vcardArray) || !Array.isArray(vcardArray[1])) return null;
  const contact: Contact = { kind: null, fn: null, org: null, emails: [] };
  for (const property of vcardArray[1]) {
    if (!Array.isArray(property) || typeof property[0] !== "string") continue;
    const value = visible(property[3]);
    if (!value) continue;
    switch (property[0].toLowerCase()) {
      case "kind":
        contact.kind = value.toLowerCase();
        break;
      case "fn":
        contact.fn = value;
        break;
      case "org":
        contact.org = value;
        break;
      case "email":
        contact.emails.push(value);
        break;
    }
  }
  return contact;
}

export function contactsOf(record: Json): Contact[] {
  const out: Contact[] = [];
  const walk = (entities: unknown): void => {
    if (!Array.isArray(entities)) return;
    for (const entity of entities) {
      if (!isObject(entity)) continue;
      const roles = Array.isArray(entity.roles) ? entity.roles.filter((r): r is string => typeof r === "string") : [];
      const skipped = roles.some((role) => SKIPPED_ROLES.has(role));
      if (!skipped && roles.some((role) => CONTACT_ROLES.has(role))) {
        const contact = readVcard(entity.vcardArray);
        if (contact) out.push(contact);
      }
      walk(entity.entities);
    }
  };
  walk(record.entities);
  return out;
}

// Without kind "individual", fn is often a role ("DNS Admin"), so it never becomes a Person.
export function linkContacts(domain: EntityOf<"Domain">, contacts: readonly Contact[]): Extracted {
  const entities: Entity[] = [];
  const relations = new Map<string, Relation>();
  const add = (relation: ReturnType<typeof createRelation>): void => {
    if (relation.ok) relations.set(relationId(relation.value), relation.value);
  };
  for (const contact of contacts) {
    const orgName = contact.org ?? (contact.kind === "org" ? contact.fn : null);
    const personName = contact.kind === "individual" ? contact.fn : null;
    const holders: Entity[] = [];
    for (const [type, name] of [
      ["Organization", orgName],
      ["Person", personName],
    ] as const) {
      if (!name) continue;
      const holder = createEntity(domain.auditId, type, { name });
      if (!holder.ok) continue;
      holders.push(holder.value);
      entities.push(holder.value);
      add(createRelation("registered_by", domain, holder.value));
    }
    for (const address of contact.emails) {
      const email = createEntity(domain.auditId, "Email", { address });
      if (!email.ok) continue;
      entities.push(email.value);
      add(createRelation("registered_by", domain, email.value));
      for (const holder of holders) add(createRelation("has_email", holder, email.value));
    }
  }
  return { entities: mergeEntities(entities), relations: [...relations.values()] };
}
