// Adapter from Electrobun's view RPC to RpcTransport; features only ever see AppClient.
import {
  AUDIT_REQUEST_LIMIT_MS,
  type AppSchema,
  type ParamsOf,
  type RequestName,
  type ResponseOf,
  type RpcTransport,
} from "@supah-osint/rpc/schema";

export async function createElectrobunTransport(): Promise<RpcTransport> {
  // electrobun/view reads these once at load; without them it uses the native bridge instead of a loopback WebSocket.
  Reflect.deleteProperty(window, "__electrobunHostSocketPort");
  Reflect.deleteProperty(window, "__electrobunRpcSocketPort");
  const { Electroview } = await import("electrobun/view");

  // Short limit for quick calls; only audits get the long one, which the Bun side's deadline stays under.
  const rpc = Electroview.defineRPC<AppSchema>({ maxRequestTime: 10_000, handlers: { requests: {}, messages: {} } });
  const view = new Electroview({ rpc });
  console.info(`supah-osint RPC transport: ${view.hostSocket ? "websocket" : "native bridge"}`);
  // Electrobun's conditional request types don't narrow for a generic name, so map each request once.
  const calls: { [K in RequestName]: (params: ParamsOf<K>) => Promise<ResponseOf<K>> } = {
    ping: (params) => rpc.request.ping(params),
    sourceHealth: (params) => rpc.request.sourceHealth(params),
    reviveSource: (params) => rpc.request.reviveSource(params),
    setSourceKeys: (params) => rpc.request.setSourceKeys(params),
    auditDomain: (params) => rpc.request.auditDomain(params, { maxRequestTime: AUDIT_REQUEST_LIMIT_MS }),
    auditEmail: (params) => rpc.request.auditEmail(params, { maxRequestTime: AUDIT_REQUEST_LIMIT_MS }),
  };
  return { request: (name, params) => calls[name](params) };
}
