// Pure parsing of crt.sh JSON (certificate-transparency log search) into subdomain entities.
import { createEntity, createRelation, type Entity, type EntityOf, type Relation } from "@supah-osint/core";

export type Extracted = { entities: Entity[]; relations: Relation[] };

// null means the body was not the JSON array crt.sh returns.
export function certificateNames(body: string): string[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const names: string[] = [];
  for (const row of parsed) {
    const value: unknown = typeof row === "object" && row !== null ? (row as { name_value?: unknown }).name_value : null;
    if (typeof value !== "string") continue;
    for (const line of value.split("\n")) names.push(line.trim().replace(/^\*\./, ""));
  }
  return names;
}

// Every subdomain links straight to the audited domain; names outside it are ignored.
export function linkSubdomains(domain: EntityOf<"Domain">, names: readonly string[]): Extracted {
  const entities = new Map<string, Entity>();
  const relations: Relation[] = [];
  for (const name of names) {
    const sub = createEntity(domain.auditId, "Domain", { name });
    if (!sub.ok || entities.has(sub.value.key) || !sub.value.key.endsWith(`.${domain.key}`)) continue;
    const edge = createRelation("subdomain_of", sub.value, domain);
    if (!edge.ok) continue;
    entities.set(sub.value.key, sub.value);
    relations.push(edge.value);
  }
  return { entities: [...entities.values()], relations };
}
