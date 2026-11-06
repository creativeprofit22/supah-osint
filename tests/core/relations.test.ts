import { describe, expect, test } from "bun:test";
import {
  ALLOWED_EDGES,
  ENTITY_TYPES,
  createEntity,
  createRelation,
  entityId,
  isAllowedEdge,
  type Result,
} from "../../packages/core/src/index.ts";

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

const person = value(createEntity("audit-1", "Person", { name: "Bob Smith" }));
const org = value(createEntity("audit-1", "Organization", { name: "Acme Ltd" }));
const email = value(createEntity("audit-1", "Email", { address: "bob@example.com" }));
const phone = value(createEntity("audit-1", "Phone", { number: "+447700900123" }));

describe("allowed edges", () => {
  test("accepts an edge listed in the table", () => {
    const relation = value(createRelation("works_for", person, org));
    expect(relation).toEqual({ auditId: "audit-1", label: "works_for", from: entityId(person), to: entityId(org) });
  });

  test("rejects edges that are not in the table", () => {
    expect(createRelation("has_email", phone, email).ok).toBe(false);
    expect(createRelation("works_for", email, org).ok).toBe(false);
    expect(isAllowedEdge("Person", "owns_domain", "Domain")).toBe(false);
  });

  test("a domain can have subdomains and contact emails", () => {
    const domain = value(createEntity("audit-1", "Domain", { name: "example.com" }));
    const sub = value(createEntity("audit-1", "Domain", { name: "mail.example.com" }));
    expect(createRelation("subdomain_of", sub, domain).ok).toBe(true);
    expect(createRelation("has_email", domain, email).ok).toBe(true);
    expect(createRelation("subdomain_of", sub, email).ok).toBe(false);
  });

  test("rejects an edge between two audits", () => {
    const otherOrg = value(createEntity("audit-2", "Organization", { name: "Acme Ltd" }));
    expect(createRelation("works_for", person, otherOrg).ok).toBe(false);
  });

  test("every table entry points at a real entity type", () => {
    for (const fromType of ENTITY_TYPES) {
      for (const targets of Object.values(ALLOWED_EDGES[fromType])) {
        for (const target of targets ?? []) expect(ENTITY_TYPES).toContain(target);
      }
    }
    expect(Object.keys(ALLOWED_EDGES).sort()).toEqual([...ENTITY_TYPES].sort());
  });
});
