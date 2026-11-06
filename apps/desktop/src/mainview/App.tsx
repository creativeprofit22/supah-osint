import type { AppClient, PingReply } from "@supah-osint/rpc/schema";
import { useState } from "react";

type PingState =
  | { kind: "idle" }
  | { kind: "waiting" }
  | { kind: "ok"; reply: PingReply; roundTripMs: number }
  | { kind: "failed"; error: string };

export function App({ client }: { client: AppClient }) {
  const [state, setState] = useState<PingState>({ kind: "idle" });

  async function ping() {
    setState({ kind: "waiting" });
    try {
      const reply = await client.ping();
      setState({ kind: "ok", reply, roundTripMs: Date.now() - reply.sentAt });
    } catch (error) {
      setState({ kind: "failed", error: error instanceof Error ? error.message : String(error) });
    }
  }

  return (
    <main className="shell">
      <h1>supah-osint</h1>
      <p className="lede">Desktop shell: React view talking to the Bun process over typed RPC.</p>
      <button type="button" onClick={ping} disabled={state.kind === "waiting"}>
        Ping
      </button>
      <output className="result" aria-live="polite">
        {state.kind === "waiting" && "Waiting for Bun…"}
        {state.kind === "ok" && (
          <>
            <strong>{state.reply.message}</strong> in {state.roundTripMs} ms from Bun {state.reply.bunVersion}
          </>
        )}
        {state.kind === "failed" && <span className="error">Ping failed: {state.error}</span>}
      </output>
    </main>
  );
}
