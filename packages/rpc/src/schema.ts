// Window <-> Bun contract. Plain types only: the view bundle imports this, so no engine/storage and no Electrobun.

export type PingParams = { sentAt: number };

export type PingReply = {
  message: "pong";
  sentAt: number;
  repliedAt: number;
  bunVersion: string;
};

// Same shape as Electrobun's ElectrobunRPCSchema, so both sides can use it as the type argument.
export type AppSchema = {
  bun: {
    requests: {
      ping: { params: PingParams; response: PingReply };
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
};

export function createAppClient(transport: RpcTransport, now: () => number = Date.now): AppClient {
  return {
    ping: () => transport.request("ping", { sentAt: now() }),
  };
}

export type BunHandlers = {
  [K in RequestName]: (params: ParamsOf<K>) => ResponseOf<K> | Promise<ResponseOf<K>>;
};

export function bunHandlers(deps: { now(): number; bunVersion: string }): BunHandlers {
  return {
    ping: ({ sentAt }) => ({
      message: "pong",
      sentAt,
      repliedAt: deps.now(),
      bunVersion: deps.bunVersion,
    }),
  };
}
