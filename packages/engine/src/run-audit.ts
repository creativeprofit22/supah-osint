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
import { systemClock } from "./clock.ts";
import type { EngineDeps } from "./deps.ts";
import { createSourceGuard, type SourceGuard } from "./guard.ts";
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

  const guard = deps.guard ?? createSourceGuard({ clock: systemClock });
  const keys = new Map<string, readonly string[]>();
  for (const source of deps.sources) {
    if (keys.has(source.id)) continue;
    // Empty keys would match (and redact) everything.
    keys.set(source.id, [...new Set(await loadKeys(deps, source.id))].filter((key) => key !== ""));
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
          if (guard.isParked(source.id)) {
            skipped.push({ sourceId: source.id, entityId: inputId, reason: "parked" });
            continue;
          }
          const sourceKeys = keys.get(source.id) ?? [];
          if (source.keyRequirement === "required" && sourceKeys.length === 0) {
            skipped.push({ sourceId: source.id, entityId: inputId, reason: "missing key" });
            continue;
          }
          const ctx: SourceContext = {
            audit,
            http: guard.http(source, deps.http, controller.signal),
            signal: controller.signal,
            key: guard.nextKey(source.id, sourceKeys),
          };
          let runnable = true;
          try {
            runnable = source.canRun ? source.canRun(input, ctx) : true;
          } catch (error) {
            waveFindings.push(failed(source.id, audit.id, input, error, sourceKeys));
            continue;
          }
          if (!runnable) {
            skipped.push({ sourceId: source.id, entityId: inputId, reason: "cannot run" });
            continue;
          }
          jobs.push(runLookup(source, input, ctx, aborted, waveFindings, guard, sourceKeys));
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
  guard: SourceGuard,
  keys: readonly string[],
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
      if (next.done) {
        guard.recordSuccess(source.id);
        return;
      }
      if (!isTrusted(next.value, source.id, ctx.audit.id)) continue;
      const clean = redactFinding(next.value, keys);
      if (clean && isTrusted(clean, source.id, ctx.audit.id)) out.push(clean);
    }
  } catch (error) {
    if (ctx.signal.aborted) return;
    guard.recordFailure(source.id);
    out.push(failed(source.id, ctx.audit.id, input, error, keys));
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

async function loadKeys(deps: EngineDeps, sourceId: string): Promise<readonly string[]> {
  try {
    const listed = (await deps.keys?.list(sourceId)) ?? [];
    return listed.filter((key): key is string => typeof key === "string");
  } catch {
    // An unreadable keychain counts as no keys; the source is then skipped or runs keyless.
    return [];
  }
}

const REDACTED = "[redacted]";

function redact(text: string, keys: readonly string[]): string {
  return keys.reduce((out, key) => out.split(key).join(REDACTED), text);
}

// Keys must never reach the store: scrub reason and url, and drop the finding if a key hides anywhere else.
function redactFinding(finding: Finding, keys: readonly string[]): Finding | null {
  if (keys.length === 0) return finding;
  const clean: Finding = {
    ...finding,
    url: finding.url === null ? null : redact(finding.url, keys),
    reason: finding.reason === null ? null : redact(finding.reason, keys),
  };
  const text = JSON.stringify(clean);
  return keys.some((key) => text.includes(key)) ? null : clean;
}

function failed(sourceId: string, auditId: string, input: Entity, error: unknown, keys: readonly string[]): Finding {
  const message = error instanceof Error ? redact(error.message.trim(), keys) : "";
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
