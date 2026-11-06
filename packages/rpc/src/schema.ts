// Window <-> Bun contract. Plain types only: the view bundle imports this, so no engine/storage and no Electrobun.

// The window waits this long for an audit; the Bun side stops its audit before then so a reply always arrives.
export const AUDIT_REQUEST_LIMIT_MS = 120_000;

export type PingParams = { sentAt: number };

export type PingReply = {
  message: "pong";
  sentAt: number;
  repliedAt: number;
  bunVersion: string;
};

// Mirrors SourceHealth in packages/engine/src/guard.ts.
export type SourceHealthRow = {
  sourceId: string;
  state: "ok" | "parked";
  failures: number;
  parkedUntil: number | null;
};

export type FindingRow = {
  source: string;
  url: string | null;
  result: "found" | "not_found" | "inconclusive";
  reason: string | null;
};

export type EntityRow = { id: string; type: string; label: string };

export type RelationRow = { from: string; label: string; to: string };

export type SkippedRow = { sourceId: string; reason: string };

export type AuditStatus = "done" | "cancelled";

export type DomainAuditReply = {
  auditId: string;
  // "cancelled": the audit hit its time limit, so the rows are partial.
  status: AuditStatus;
  findings: FindingRow[];
  entities: EntityRow[];
  relations: RelationRow[];
  skipped: SkippedRow[];
};

// Same shape as Electrobun's ElectrobunRPCSchema, so both sides can use it as the type argument.
export type AppSchema = {
  bun: {
    requests: {
      ping: { params: PingParams; response: PingReply };
      sourceHealth: { params: Record<never, never>; response: SourceHealthRow[] };
      reviveSource: { params: { sourceId: string }; response: { revived: true } };
      // Only the count comes back; key text never crosses back to the window.
      setSourceKeys: { params: { sourceId: string; keys: string[] }; response: { saved: number } };
      auditDomain: { params: { subjectName: string; domain: string }; response: DomainAuditReply };
    };
    messages: Record<never, never>;
  };
  webview: {
    requests: Record<never, never>;
    messages: Record<never, never>;
  };
};

export type BunRequests = AppSchema["bun"]["requests"];
export type RequestName = keyof BunRequests;
export type ParamsOf<K extends RequestName> = BunRequests[K]["params"];
export type ResponseOf<K extends RequestName> = BunRequests[K]["response"];

export type RpcTransport = {
  request<K extends RequestName>(name: K, params: ParamsOf<K>): Promise<ResponseOf<K>>;
};

export type AppClient = {
  ping(): Promise<PingReply>;
  sourceHealth(): Promise<SourceHealthRow[]>;
  reviveSource(sourceId: string): Promise<{ revived: true }>;
  setSourceKeys(sourceId: string, keys: string[]): Promise<{ saved: number }>;
  auditDomain(subjectName: string, domain: string): Promise<DomainAuditReply>;
};

export function createAppClient(transport: RpcTransport, now: () => number = Date.now): AppClient {
  return {
    ping: () => transport.request("ping", { sentAt: now() }),
    sourceHealth: () => transport.request("sourceHealth", {}),
    reviveSource: (sourceId) => transport.request("reviveSource", { sourceId }),
    setSourceKeys: (sourceId, keys) => transport.request("setSourceKeys", { sourceId, keys }),
    auditDomain: (subjectName, domain) => transport.request("auditDomain", { subjectName, domain }),
  };
}

export type BunHandlers = {
  [K in RequestName]: (params: ParamsOf<K>) => ResponseOf<K> | Promise<ResponseOf<K>>;
};

// Structural, so the app's Rpc fits without this file importing it.
export type SourceControls = {
  sourceHealth(): readonly SourceHealthRow[] | Promise<readonly SourceHealthRow[]>;
  reviveSource(sourceId: string): void | Promise<void>;
  setSourceKeys(sourceId: string, keys: readonly string[]): void | Promise<void>;
};

// Structural too; extra fields on the app's rows are dropped before they reach the window.
export type DomainAudits = {
  auditDomain(
    subjectName: string,
    domain: string,
  ): Promise<{
    auditId: string;
    status: AuditStatus;
    findings: readonly FindingRow[];
    entities: readonly EntityRow[];
    relations: readonly RelationRow[];
    skipped: readonly SkippedRow[];
  }>;
};

export function bunHandlers(deps: {
  now(): number;
  bunVersion: string;
  sources: SourceControls;
  audits: DomainAudits;
}): BunHandlers {
  return {
    ping: ({ sentAt }) => ({
      message: "pong",
      sentAt,
      repliedAt: deps.now(),
      bunVersion: deps.bunVersion,
    }),
    sourceHealth: async () =>
      (await deps.sources.sourceHealth()).map(({ sourceId, state, failures, parkedUntil }) => ({
        sourceId,
        state,
        failures,
        parkedUntil,
      })),
    reviveSource: async (params) => {
      await deps.sources.reviveSource(validSourceId(params));
      return { revived: true };
    },
    setSourceKeys: async (params) => {
      const sourceId = validSourceId(params);
      const keys = (params as { keys?: unknown } | undefined)?.keys;
      // The error names the problem only, never the values, since they may be keys.
      if (!Array.isArray(keys) || !keys.every((key) => typeof key === "string")) {
        throw new TypeError("keys must be an array of strings");
      }
      await deps.sources.setSourceKeys(sourceId, keys);
      return { saved: keys.length };
    },
    auditDomain: async (params) => {
      const subjectName = nonEmptyString(params, "subjectName");
      const domain = nonEmptyString(params, "domain");
      const run = await deps.audits.auditDomain(subjectName, domain);
      return {
        auditId: run.auditId,
        status: run.status,
        findings: run.findings.map(({ source, url, result, reason }) => ({ source, url, result, reason })),
        entities: run.entities.map(({ id, type, label }) => ({ id, type, label })),
        relations: run.relations.map(({ from, label, to }) => ({ from, label, to })),
        skipped: run.skipped.map(({ sourceId, reason }) => ({ sourceId, reason })),
      };
    },
  };
}

// Params arrive from the window at runtime, so the static types aren't a guarantee.
function validSourceId(params: unknown): string {
  return nonEmptyString(params, "sourceId");
}

function nonEmptyString(params: unknown, field: string): string {
  const value = (params as Record<string, unknown> | undefined)?.[field];
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${field} must be a non-empty string`);
  return value;
}
