// Window <-> Bun contract. Plain types only: the view bundle imports this, so no engine/storage and no Electrobun.

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

// Same shape as Electrobun's ElectrobunRPCSchema, so both sides can use it as the type argument.
export type AppSchema = {
  bun: {
    requests: {
      ping: { params: PingParams; response: PingReply };
      sourceHealth: { params: Record<never, never>; response: SourceHealthRow[] };
      reviveSource: { params: { sourceId: string }; response: { revived: true } };
      // Only the count comes back; key text never crosses back to the window.
      setSourceKeys: { params: { sourceId: string; keys: string[] }; response: { saved: number } };
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
};

export function createAppClient(transport: RpcTransport, now: () => number = Date.now): AppClient {
  return {
    ping: () => transport.request("ping", { sentAt: now() }),
    sourceHealth: () => transport.request("sourceHealth", {}),
    reviveSource: (sourceId) => transport.request("reviveSource", { sourceId }),
    setSourceKeys: (sourceId, keys) => transport.request("setSourceKeys", { sourceId, keys }),
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

export function bunHandlers(deps: { now(): number; bunVersion: string; sources: SourceControls }): BunHandlers {
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
  };
}

// Params arrive from the window at runtime, so the static types aren't a guarantee.
function validSourceId(params: unknown): string {
  const sourceId = (params as { sourceId?: unknown } | undefined)?.sourceId;
  if (typeof sourceId !== "string" || sourceId.trim() === "") {
    throw new TypeError("sourceId must be a non-empty string");
  }
  return sourceId;
}
