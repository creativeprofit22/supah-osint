import type { AppClient, PingReply, SourceHealthRow } from "@supah-osint/rpc/schema";
import { useCallback, useEffect, useState, type FormEvent } from "react";

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
      setState({ kind: "failed", error: errorText(error) });
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
      <SourcesPanel client={client} />
    </main>
  );
}

function SourcesPanel({ client }: { client: AppClient }) {
  const [rows, setRows] = useState<SourceHealthRow[] | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [reviving, setReviving] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setRows(await client.sourceHealth());
      setHealthError(null);
    } catch (error) {
      setHealthError(errorText(error));
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function revive(sourceId: string) {
    setReviving(sourceId);
    try {
      await client.reviveSource(sourceId);
      await refresh();
    } catch (error) {
      setHealthError(errorText(error));
    } finally {
      setReviving(null);
    }
  }

  return (
    <section className="panel" aria-labelledby="sources-heading">
      <h2 id="sources-heading">Sources</h2>
      <button type="button" onClick={() => void refresh()}>
        Refresh
      </button>
      {healthError && <p className="error">Source health failed: {healthError}</p>}
      {rows !== null && rows.length === 0 && <p>No source has been called yet.</p>}
      {rows !== null && rows.length > 0 && (
        <table className="health">
          <thead>
            <tr>
              <th scope="col">Source</th>
              <th scope="col">State</th>
              <th scope="col">Failures</th>
              <th scope="col">Parked until</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.sourceId}>
                <td>{row.sourceId}</td>
                <td>{row.state === "parked" ? <span className="badge parked">parked</span> : "ok"}</td>
                <td>{row.failures}</td>
                <td>{row.parkedUntil === null ? "—" : new Date(row.parkedUntil).toLocaleTimeString()}</td>
                <td>
                  {row.state === "parked" && (
                    <button type="button" onClick={() => void revive(row.sourceId)} disabled={reviving !== null}>
                      Revive
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <KeyForm client={client} sourceIds={rows?.map((row) => row.sourceId) ?? []} onSaved={refresh} />
    </section>
  );
}

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; sourceId: string; count: number } | { kind: "failed"; error: string };

function KeyForm({ client, sourceIds, onSaved }: { client: AppClient; sourceIds: string[]; onSaved: () => Promise<void> }) {
  const [sourceId, setSourceId] = useState("");
  const [keysText, setKeysText] = useState("");
  const [save, setSave] = useState<SaveState>({ kind: "idle" });

  async function submit(event: FormEvent) {
    event.preventDefault();
    const id = sourceId.trim();
    const keys = keysText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== "");
    setSave({ kind: "saving" });
    try {
      const { saved } = await client.setSourceKeys(id, keys);
      setKeysText("");
      setSave({ kind: "saved", sourceId: id, count: saved });
      await onSaved();
    } catch (error) {
      // Only the message, never the submitted keys.
      setSave({ kind: "failed", error: errorText(error) });
    }
  }

  return (
    <form className="key-form" onSubmit={submit}>
      <h3>API keys</h3>
      <label>
        Source id
        <input
          value={sourceId}
          onChange={(event) => setSourceId(event.target.value)}
          list="known-sources"
          required
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <datalist id="known-sources">
        {sourceIds.map((id) => (
          <option key={id} value={id} />
        ))}
      </datalist>
      <label>
        Keys, one per line
        {/* A textarea so several keys fit; the class masks it like a password input. */}
        <textarea
          className="secret"
          value={keysText}
          onChange={(event) => setKeysText(event.target.value)}
          rows={3}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />
      </label>
      <button type="submit" disabled={save.kind === "saving" || sourceId.trim() === ""}>
        Save keys
      </button>
      <output className="result" aria-live="polite">
        {save.kind === "saving" && "Saving…"}
        {save.kind === "saved" && `Saved ${save.count} key${save.count === 1 ? "" : "s"} for ${save.sourceId}.`}
        {save.kind === "failed" && <span className="error">Saving keys failed: {save.error}</span>}
      </output>
    </form>
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
