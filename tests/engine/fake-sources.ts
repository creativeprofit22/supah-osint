import { createEntity, createRelation, entityId, type Audit, type Entity, type EntityType, type Finding, type RelationLabel } from "../../packages/core/src/index.ts";
import type { Http, KeyRequirement, Source, SourceContext } from "../../packages/engine/src/index.ts";

export const audit: Audit = { id: "audit-1", subjectName: "Ada Lovelace" };

export const http: Http = { get: async () => ({ status: 200, body: "" }) };

export function account(service: string, username: string, auditId = audit.id): Entity {
  const made = createEntity(auditId, "Account", { service, username });
  if (!made.ok) throw new Error(made.error);
  return made.value;
}

export function email(address: string, auditId = audit.id): Entity {
  const made = createEntity(auditId, "Email", { address });
  if (!made.ok) throw new Error(made.error);
  return made.value;
}

export function finding(source: string, overrides: Partial<Finding> = {}): Finding {
  return {
    auditId: audit.id,
    source,
    url: "https://example.com/a",
    foundAt: 1,
    confidence: 0.9,
    result: "found",
    reason: null,
    entities: [],
    relations: [],
    ...overrides,
  };
}

// A found finding that joins `input` to each of `linked` with `label`, plus any unlinked extras.
export function linkFinding(
  source: string,
  input: Entity,
  label: RelationLabel,
  linked: readonly Entity[],
  extras: readonly Entity[] = [],
): Finding {
  const relations = linked.map((to) => {
    const made = createRelation(label, input, to);
    if (!made.ok) throw new Error(made.error);
    return made.value;
  });
  return finding(source, {
    url: `https://example.com/${source}/${entityId(input)}`,
    entities: [input, ...linked, ...extras],
    relations,
  });
}

export type Call = { sourceId: string; entityId: string; key: string | null };

export function callLog(): Call[] {
  return [];
}

export function fakeSource(options: {
  id: string;
  accepts: readonly EntityType[];
  calls: Call[];
  keyRequirement?: KeyRequirement;
  canRun?: Source["canRun"];
  produce: (input: Entity, ctx: SourceContext) => readonly Finding[] | Promise<readonly Finding[]>;
}): Source {
  return {
    id: options.id,
    accepts: options.accepts,
    keyRequirement: options.keyRequirement ?? "none",
    ...(options.canRun ? { canRun: options.canRun } : {}),
    async *run(input, ctx) {
      options.calls.push({ sourceId: options.id, entityId: entityId(input), key: ctx.key });
      yield* await options.produce(input, ctx);
    },
  };
}
