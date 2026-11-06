// Ring 2 (application): runs sources breadth-first, feeding each in-scope entity to the sources that accept it.
import {
  createEntity,
  createFinding,
  dedupeFindings,
  entityId,
  mergeEntities,
  type Audit,
  type Entity,
  type EntityId,
  type EntityType,
  type Finding,
} from "@supah-osint/core";
import type { EngineDeps } from "./deps.ts";
import type { Source, SourceContext } from "./source.ts";

export type SkippedLookup = { sourceId: string; entityId: EntityId; reason: string };

export type AuditRun = {
  findings: Finding[];
  status: "done" | "cancelled";
  skipped: SkippedLookup[];
};

export type RunAuditOptions = {
  audit: Audit;
  // Entities the subject consented to being looked up from, e.g. their own email.
  seeds?: readonly Entity[];
  maxDepth?: number;
  signal?: AbortSignal;
};

export async function runAudit(deps: EngineDeps, options: RunAuditOptions): Promise<AuditRun> {
  const { audit, seeds = [], maxDepth = 3, signal } = options;
  for (const seed of seeds) {
    if (seed.auditId !== audit.id) throw new Error(`seed ${entityId(seed)} belongs to another audit`);
  }
  const subject = createEntity(audit.id, "Person", { name: audit.subjectName });
  const roots = mergeEntities(subject.ok ? [subject.value, ...seeds] : seeds);

  const registry = new Map<EntityType, Source[]>();
  for (const source of deps.sources) {
    for (const type of new Set(source.accepts)) registry.set(type, [...(registry.get(type) ?? []), source]);
  }

  const controller = new AbortController();
  const follow = () => controller.abort(signal?.reason);
  if (signal?.aborted) follow();
  else signal?.addEventListener("abort", follow, { once: true });
  const aborted = new Promise<"aborted">((resolve) => {
    if (controller.signal.aborted) resolve("aborted");
    else controller.signal.addEventListener("abort", () => resolve("aborted"), { once: true });
  });

  // The privacy rule: only entities linked to the subject (or a consented seed) are ever looked up.
  const inScope = new Map<EntityId, number>(roots.map((root) => [entityId(root), 0]));
  const handled = new Set<string>();
  const skipped: SkippedLookup[] = [];
  const all: Finding[] = [];

  try {
    await deps.store.saveAudit(audit);
    let wave = roots;
    let depth = 0;
    while (wave.length > 0 && !controller.signal.aborted) {
      const waveFindings: Finding[] = [];
      const jobs: Promise<void>[] = [];
      for (const input of wave) {
        const inputId = entityId(input);
        for (const source of registry.get(input.type) ?? []) {
          const pair = `${source.id}|${inputId}`;
          if (handled.has(pair)) continue;
          handled.add(pair);
          const ctx: SourceContext = { audit, http: deps.http, signal: controller.signal, key: deps.keys?.[source.id] ?? null };
          if (source.keyRequirement === "required" && ctx.key === null) {
            skipped.push({ sourceId: source.id, entityId: inputId, reason: "missing key" });
            continue;
          }
          let runnable = true;
          try {
            runnable = source.canRun ? source.canRun(input, ctx) : true;
          } catch (error) {
            waveFindings.push(failed(source.id, audit.id, input, error));
            continue;
          }
          if (!runnable) {
            skipped.push({ sourceId: source.id, entityId: inputId, reason: "cannot run" });
            continue;
          }
          jobs.push(runLookup(source, input, ctx, aborted, waveFindings));
        }
      }
      await Promise.all(jobs);
      all.push(...waveFindings);
      wave = depth + 1 <= maxDepth ? extendScope(waveFindings, inScope, depth + 1) : [];
      depth += 1;
    }
  } finally {
    signal?.removeEventListener("abort", follow);
  }

  const findings = dedupeFindings(all);
  await deps.store.saveFindings(findings);
  return { findings, status: controller.signal.aborted ? "cancelled" : "done", skipped };
}

// Adds entities joined (either direction) to an in-scope entity; repeats so chains inside a finding count.
function extendScope(findings: readonly Finding[], inScope: Map<EntityId, number>, depth: number): Entity[] {
  const byId = new Map<EntityId, Entity>();
  for (const finding of findings) for (const entity of finding.entities) byId.set(entityId(entity), entity);
  const relations = findings.flatMap((finding) => finding.relations);
  const added: Entity[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const relation of relations) {
      for (const [known, other] of [[relation.from, relation.to], [relation.to, relation.from]] as const) {
        const entity = byId.get(other);
        if (!inScope.has(known) || inScope.has(other) || !entity) continue;
        inScope.set(other, depth);
        added.push(entity);
        changed = true;
      }
    }
  }
  return added;
}

async function runLookup(
  source: Source,
  input: Entity,
  ctx: SourceContext,
  aborted: Promise<"aborted">,
  out: Finding[],
): Promise<void> {
  try {
    const iterator = source.run(input, ctx)[Symbol.asyncIterator]();
    while (true) {
      const pending = iterator.next();
      pending.catch(() => {});
      // Racing lets go of a source that ignores the signal.
      const next = await Promise.race([pending, aborted]);
      if (next === "aborted") {
        Promise.resolve(iterator.return?.()).catch(() => {});
        return;
      }
      if (next.done) return;
      if (isTrusted(next.value, source.id, ctx.audit.id)) out.push(next.value);
    }
  } catch (error) {
    if (ctx.signal.aborted) return;
    out.push(failed(source.id, ctx.audit.id, input, error));
  }
}

// Sources are untrusted: drop findings that break the Finding rules, belong to another audit or claim another source.
function isTrusted(value: unknown, sourceId: string, auditId: string): value is Finding {
  try {
    const finding = value as Finding;
    return typeof value === "object" && value !== null && finding.auditId === auditId && finding.source === sourceId && createFinding(finding).ok;
  } catch {
    return false;
  }
}

function failed(sourceId: string, auditId: string, input: Entity, error: unknown): Finding {
  const message = error instanceof Error ? error.message.trim() : "";
  return {
    auditId,
    source: sourceId,
    // One slot per failed input, so dedupe and the store can't merge it away or let it replace another answer.
    url: `engine-failure:${entityId(input)}`,
    foundAt: Date.now(),
    confidence: 0,
    result: "inconclusive",
    reason: message === "" ? "source failed" : message,
    entities: [],
    relations: [],
  };
}
