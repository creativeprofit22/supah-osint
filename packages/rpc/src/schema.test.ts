import { expect, test } from "bun:test";
import { bunHandlers, createAppClient, type RpcTransport } from "./schema.ts";

test("ping round-trips through a transport with a typed pong", async () => {
  const handlers = bunHandlers({ now: () => 2000, bunVersion: "1.4.4" });
  const transport: RpcTransport = {
    request: async (name, params) => handlers[name](params),
  };
  const client = createAppClient(transport, () => 1000);

  expect(await client.ping()).toEqual({
    message: "pong",
    sentAt: 1000,
    repliedAt: 2000,
    bunVersion: "1.4.4",
  });
});
