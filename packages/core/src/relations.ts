// Labelled edges between entities, limited to the pairs listed in ALLOWED_EDGES.
import { entityId, type AuditId, type Entity, type EntityId, type EntityType } from "./entities.ts";
import { err, ok, type Result } from "./normalize.ts";

export type RelationLabel =
  | "works_for"
  | "has_email"
  | "has_phone"
  | "has_account"
  | "has_username"
  | "has_url"
  | "lives_at"
  | "located_at"
  | "located_in"
  | "associated_with"
  | "owns_domain"
  | "linked_to"
  | "on_domain"
  | "registered_by"
  | "subdomain_of"
  | "exposed_in";

export const ALLOWED_EDGES: Readonly<Record<EntityType, Partial<Record<RelationLabel, readonly EntityType[]>>>> = {
  Person: {
    works_for: ["Organization"],
    has_email: ["Email"],
    has_phone: ["Phone"],
    has_account: ["Account"],
    has_username: ["Username"],
    has_url: ["Url"],
    lives_at: ["Address"],
    located_in: ["Location"],
    associated_with: ["Person"],
  },
  Organization: {
    has_email: ["Email"],
    has_phone: ["Phone"],
    has_account: ["Account"],
    has_url: ["Url"],
    located_at: ["Address"],
    located_in: ["Location"],
    owns_domain: ["Domain"],
  },
  Account: {
    has_email: ["Email"],
    has_phone: ["Phone"],
    has_url: ["Url"],
    has_username: ["Username"],
    linked_to: ["Account"],
  },
  Email: { on_domain: ["Domain"], exposed_in: ["Breach"] },
  Url: { on_domain: ["Domain"] },
  Domain: { registered_by: ["Person", "Organization", "Email"], subdomain_of: ["Domain"], has_email: ["Email"] },
  Address: { located_in: ["Location"] },
  Phone: {},
  Location: {},
  Username: {},
  Breach: {},
};

export type Relation = {
  auditId: AuditId;
  label: RelationLabel;
  from: EntityId;
  to: EntityId;
};

export function isAllowedEdge(fromType: EntityType, label: RelationLabel, toType: EntityType): boolean {
  return ALLOWED_EDGES[fromType][label]?.includes(toType) ?? false;
}

export function createRelation(label: RelationLabel, from: Entity, to: Entity): Result<Relation> {
  if (from.auditId !== to.auditId) return err("relation cannot join entities from different audits");
  if (!isAllowedEdge(from.type, label, to.type)) return err(`edge not allowed: ${from.type} ${label} ${to.type}`);
  return ok({ auditId: from.auditId, label, from: entityId(from), to: entityId(to) });
}

export function relationId(relation: Relation): string {
  return `${relation.from}|${relation.label}|${relation.to}`;
}
