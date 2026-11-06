// Typed entities. Each one belongs to an Audit and is identified by a normalized key.
import {
  err,
  normalizeAccount,
  normalizeDomain,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  normalizeText,
  normalizeUrl,
  ok,
  type PhoneOptions,
  type Result,
} from "./normalize.ts";

export type AuditId = string;

// One audit covers one consenting subject.
export type Audit = {
  id: AuditId;
  subjectName: string;
};

export type EntityType =
  | "Person"
  | "Organization"
  | "Account"
  | "Email"
  | "Phone"
  | "Domain"
  | "Address"
  | "Location"
  | "Url";

export const ENTITY_TYPES: readonly EntityType[] = [
  "Person",
  "Organization",
  "Account",
  "Email",
  "Phone",
  "Domain",
  "Address",
  "Location",
  "Url",
];

export type EntityProps = {
  Person: { name: string };
  Organization: { name: string };
  Account: { service: string; username: string };
  Email: { address: string };
  Phone: { e164: string };
  Domain: { name: string };
  Address: { text: string };
  Location: { name: string };
  Url: { href: string };
};

export type RawEntityProps = Omit<EntityProps, "Phone"> & { Phone: { number: string } };

export type EntityOf<K extends EntityType> = {
  auditId: AuditId;
  type: K;
  key: string;
  props: EntityProps[K];
};

export type Entity = { [K in EntityType]: EntityOf<K> }[EntityType];

export type EntityId = string;

type Built<K extends EntityType> = Result<{ key: string; props: EntityProps[K] }>;
type Builder<K extends EntityType> = (raw: RawEntityProps[K], options: PhoneOptions) => Built<K>;

function tidy(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

function named<K extends "Person" | "Organization" | "Location">(raw: { name: string }): Built<K> {
  const key = normalizeName(raw.name);
  return key.ok ? ok({ key: key.value, props: { name: tidy(raw.name) } }) : key;
}

function textual(raw: { text: string }): Built<"Address"> {
  const key = normalizeText(raw.text);
  return key === "" ? err("address is empty") : ok({ key, props: { text: tidy(raw.text) } });
}

// Person and Organization merge on exact normalized name; fine within one audit's single subject.
const builders: { [K in EntityType]: Builder<K> } = {
  Person: (raw) => named(raw),
  Organization: (raw) => named(raw),
  Location: (raw) => named(raw),
  Address: (raw) => textual(raw),
  Account: (raw) => {
    const key = normalizeAccount(raw.service, raw.username);
    return key.ok ? ok({ key: key.value, props: { service: raw.service.trim(), username: raw.username.trim() } }) : key;
  },
  Email: (raw) => {
    const key = normalizeEmail(raw.address);
    return key.ok ? ok({ key: key.value, props: { address: key.value } }) : key;
  },
  Phone: (raw, options) => {
    const key = normalizePhone(raw.number, options);
    return key.ok ? ok({ key: key.value, props: { e164: key.value } }) : key;
  },
  Domain: (raw) => {
    const key = normalizeDomain(raw.name);
    return key.ok ? ok({ key: key.value, props: { name: key.value } }) : key;
  },
  Url: (raw) => {
    const key = normalizeUrl(raw.href);
    return key.ok ? ok({ key: key.value, props: { href: key.value } }) : key;
  },
};

export function createEntity<K extends EntityType>(
  auditId: AuditId,
  type: K,
  raw: RawEntityProps[K],
  options: PhoneOptions = {},
): Result<EntityOf<K>> {
  if (auditId.trim() === "") return err("entity needs an auditId");
  const built = builders[type](raw, options);
  if (!built.ok) return built;
  return ok({ auditId, type, key: built.value.key, props: built.value.props });
}

export function entityId(entity: Entity): EntityId {
  return `${entity.auditId}|${entity.type}|${entity.key}`;
}

export function mergeEntities(entities: readonly Entity[]): Entity[] {
  const seen = new Map<EntityId, Entity>();
  for (const entity of entities) {
    const id = entityId(entity);
    if (!seen.has(id)) seen.set(id, entity);
  }
  return [...seen.values()];
}
