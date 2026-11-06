// Adapter from Electrobun's view RPC to RpcTransport; features only ever see AppClient.
import type { AppSchema, ParamsOf, RequestName, ResponseOf, RpcTransport } from "@supah-osint/rpc/schema";

export async function createElectrobunTransport(): Promise<RpcTransport> {
  // electrobun/view reads these once at load; without them it uses the native bridge instead of a loopback WebSocket.
  Reflect.deleteProperty(window, "__electrobunHostSocketPort");
  Reflect.deleteProperty(window, "__electrobunRpcSocketPort");
  const { Electroview } = await import("electrobun/view");

  const rpc = Electroview.defineRPC<AppSchema>({ handlers: { requests: {}, messages: {} } });
  const view = new Electroview({ rpc });
  console.info(`supah-osint RPC transport: ${view.hostSocket ? "websocket" : "native bridge"}`);
  // Electrobun's conditional request types don't narrow for a generic name, so map each request once.
  const calls: { [K in RequestName]: (params: ParamsOf<K>) => Promise<ResponseOf<K>> } = {
    ping: (params) => rpc.request.ping(params),
    sourceHealth: (params) => rpc.request.sourceHealth(params),
    reviveSource: (params) => rpc.request.reviveSource(params),
    setSourceKeys: (params) => rpc.request.setSourceKeys(params),
  };
  return { request: (name, params) => calls[name](params) };
}
