// Ring 3 (adapter): the only door from entry points into the app.
import {
  createEntity,
  entityId,
  mergeGraph,
  type Audit,
  type AuditId,
  type Entity,
  type Finding,
  type Relation,
  type Result,
} from "@supah-osint/core";
import {
  createSourceGuard,
  listFindings,
  runAudit,
  systemClock,
  type EngineDeps,
  type KeySource,
  type Source,
  type SourceHealth,
} from "@supah-osint/engine";
import { createKeychainKeys } from "@supah-osint/keychain";
import { crtshSource } from "@supah-osint/source-crtsh";
import { dnsSource } from "@supah-osint/source-dns";
import { emailSignupsSource } from "@supah-osint/source-email-signups";
import { hibpSource } from "@supah-osint/source-hibp";
import { rdapSource } from "@supah-osint/source-rdap";
import { openSqliteStore } from "@supah-osint/storage";
import { AUDIT_REQUEST_LIMIT_MS } from "./schema.ts";

export { defaultDatabasePath } from "@supah-osint/storage";
export type { SourceHealth } from "@supah-osint/engine";

export type WritableKeys = KeySource & { set(sourceId: string, keys: readonly string[]): Promise<void> };

export type DomainAudit = {
  auditId: AuditId;
  // "cancelled" when the deadline hit; lookups still running then left no finding.
  status: "done" | "cancelled";
  findings: Finding[];
  entities: (Entity & { id: string; label: string })[];
  relations: Relation[];
  // Lookups the engine did not run, e.g. a parked source; never the same as nothing found.
  skipped: { sourceId: string; reason: string }[];
};

export type Rpc = {
  search(audit: Audit): Promise<Finding[]>;
  auditDomain(subjectName: string, domain: string): Promise<DomainAudit>;
  auditEmail(subjectName: string, email: string, options: { checkRegistrations: boolean }): Promise<DomainAudit>;
  findings(auditId: AuditId): Promise<Finding[]>;
  sourceHealth(): SourceHealth[];
  reviveSource(sourceId: string): void;
  setSourceKeys(sourceId: string, keys: readonly string[]): Promise<void>;
};

// Keyless lookups for a domain the subject owns.
export function domainSources(): Source[] {
  return [dnsSource(), rdapSource(), crtshSource()];
}

// Breach lookups for an email the subject owns (Have I Been Pwned needs the user's key).
export function emailSources(): Source[] {
  return [hibpSource()];
}

// Asks sites' sign-up, login or reset forms about the email; only runs when the user opts in.
export function registrationSources(): Source[] {
  return [emailSignupsSource()];
}

export type RpcSourceOptions = {
  auditDeadlineMs?: number;
  emailSources?: readonly Source[];
  registrationSources?: readonly Source[];
};

function entityLabel(entity: Entity): string {
  if (entity.type === "Breach") {
    const { title, breachDate } = entity.props;
    return breachDate ? `${title} (breached ${breachDate})` : title;
  }
  return Object.values(entity.props).join(" · ");
}

// Leaves headroom under the window's request limit for saving and sending the reply.
const AUDIT_DEADLINE_MS = AUDIT_REQUEST_LIMIT_MS - 10_000;

export function createRpc(
  options: Omit<EngineDeps, "keys"> & { keys?: KeySource | WritableKeys } & RpcSourceOptions,
): Rpc {
  const {
    auditDeadlineMs = AUDIT_DEADLINE_MS,
    emailSources: breachLookups = emailSources(),
    registrationSources: signupLookups = registrationSources(),
    ...deps
  } = options;
  // One guard for the app's lifetime, so parked sources and key rotation carry across audits.
  const guard = deps.guard ?? createSourceGuard({ clock: systemClock });
  const engine: EngineDeps = { ...deps, guard };

  // Depth 0: only the subject's own seed is looked up, never the subdomains or third parties it points at.
  const auditSeed = async (
    subjectName: string,
    sources: readonly Source[],
    seedOf: (audit: Audit) => Result<Entity>,
  ) => {
    const audit: Audit = { id: crypto.randomUUID(), subjectName };
    const seed = seedOf(audit);
    if (!seed.ok) throw new TypeError(seed.error);
    const signal = AbortSignal.timeout(auditDeadlineMs);
    const run = await runAudit({ ...engine, sources }, { audit, seeds: [seed.value], maxDepth: 0, signal });
    const { findings } = run;
    const { entities, relations } = mergeGraph(findings);
    const reply: DomainAudit = {
      auditId: audit.id,
      status: run.status,
      findings,
      entities: entities.map((entity) => ({ ...entity, id: entityId(entity), label: entityLabel(entity) })),
      relations,
      skipped: run.skipped.map(({ sourceId, reason }) => ({ sourceId, reason })),
    };
    return reply;
  };

  return {
    search: async (audit) => (await runAudit(engine, { audit })).findings,
    auditDomain: (subjectName, domain) =>
      auditSeed(subjectName, engine.sources, (audit) => createEntity(audit.id, "Domain", { name: domain })),
    auditEmail: (subjectName, email, { checkRegistrations }) => {
      // Strictly true: sign-up checks may email the address owner, so nothing else turns them on.
      const sources = checkRegistrations === true ? [...breachLookups, ...signupLookups] : breachLookups;
      return auditSeed(subjectName, sources, (audit) => createEntity(audit.id, "Email", { address: email }));
    },
    findings: (auditId) => listFindings(engine, auditId),
    sourceHealth: () => guard.health(),
    reviveSource: (sourceId) => guard.revive(sourceId),
    setSourceKeys: async (sourceId, keys) => {
      const store = deps.keys;
      if (!store || !("set" in store)) throw new Error("this key store is read-only");
      await store.set(sourceId, keys);
      // A source parked for a bad key should get a fresh try with the new one.
      guard.revive(sourceId);
    },
  };
}

// Opens (and migrates) the database file; call close() when the app shuts down. Sources default to domainSources().
export function openStoredRpc(
  deps: Omit<EngineDeps, "store" | "keys" | "sources"> &
    RpcSourceOptions & {
      databasePath: string;
      keys?: KeySource | WritableKeys;
      sources?: readonly Source[];
    },
): Rpc & { close(): void } {
  const { databasePath, sources = domainSources(), ...rest } = deps;
  const store = openSqliteStore(databasePath);
  return {
    ...createRpc({ ...rest, sources, keys: rest.keys ?? createKeychainKeys(), store }),
    close: () => store.close(),
  };
}
