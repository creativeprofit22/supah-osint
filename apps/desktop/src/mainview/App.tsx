import type { AppClient, DomainAuditReply, EntityRow, FindingRow, PingReply, SourceHealthRow } from "@supah-osint/rpc/schema";
import { useCallback, useEffect, useState, type FormEvent } from "react";

type PingState =
  | { kind: "idle" }
  | { kind: "waiting" }
  | { kind: "ok"; reply: PingReply; roundTripMs: number }
  | { kind: "failed"; error: string };

export function App({ client }: { client: AppClient }) {
  const [state, setState] = useState<PingState>({ kind: "idle" });
  // Bumped after each audit, since audits change source failure counts and parking.
  const [healthVersion, setHealthVersion] = useState(0);

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
      <DomainAuditPanel client={client} onAuditFinished={() => setHealthVersion((v) => v + 1)} />
      <SourcesPanel client={client} healthVersion={healthVersion} />
    </main>
  );
}

type AuditState =
  | { kind: "idle" }
  | { kind: "running"; domain: string }
  | { kind: "done"; reply: DomainAuditReply }
  | { kind: "failed"; error: string };

const RESULT_TEXT: Record<FindingRow["result"], string> = {
  found: "found",
  not_found: "nothing found",
  inconclusive: "inconclusive",
};

function DomainAuditPanel({ client, onAuditFinished }: { client: AppClient; onAuditFinished: () => void }) {
  const [subjectName, setSubjectName] = useState("");
  const [domain, setDomain] = useState("");
  const [audit, setAudit] = useState<AuditState>({ kind: "idle" });

  async function submit(event: FormEvent) {
    event.preventDefault();
    const target = domain.trim();
    setAudit({ kind: "running", domain: target });
    try {
      setAudit({ kind: "done", reply: await client.auditDomain(subjectName.trim(), target) });
    } catch (error) {
      setAudit({ kind: "failed", error: errorText(error) });
    } finally {
      onAuditFinished();
    }
  }

  const blank = subjectName.trim() === "" || domain.trim() === "";
  return (
    <section className="panel" aria-labelledby="audit-heading">
      <h2 id="audit-heading">Domain audit</h2>
      <form className="key-form" onSubmit={submit}>
        <label>
          Your name
          <input value={subjectName} onChange={(event) => setSubjectName(event.target.value)} required autoComplete="name" />
        </label>
        <label>
          Domain you own
          <input
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
            required
            placeholder="example.com"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <button type="submit" disabled={audit.kind === "running" || blank}>
          Run domain audit
        </button>
      </form>
      <output className="result" aria-live="polite">
        {audit.kind === "running" && `Checking ${audit.domain}…`}
        {audit.kind === "done" && summary(audit.reply)}
        {audit.kind === "failed" && <span className="error">Domain audit failed: {audit.error}</span>}
      </output>
      {audit.kind === "done" && <AuditResults reply={audit.reply} />}
    </section>
  );
}

function summary(reply: DomainAuditReply): string {
  // Skipped lookups never ran, so they count as not checked.
  const unsure = reply.findings.filter((finding) => finding.result === "inconclusive").length + reply.skipped.length;
  const base = `${reply.findings.length + reply.skipped.length} checks, ${reply.entities.length} entities, ${reply.relations.length} links.`;
  const checked = unsure === 0 ? base : `${base} ${unsure} could not be checked.`;
  if (reply.status !== "cancelled") return checked;
  // Lookups cut off by the deadline leave no row, so a missing source means not checked, not nothing found.
  return `Audit stopped at the time limit, so these results are partial. ${checked} Lookups still running were dropped and are not listed; a missing source was not checked.`;
}

function AuditResults({ reply }: { reply: DomainAuditReply }) {
  const labels = new Map(reply.entities.map((entity) => [entity.id, entity.label]));
  const byType = new Map<string, EntityRow[]>();
  for (const entity of reply.entities) byType.set(entity.type, [...(byType.get(entity.type) ?? []), entity]);

  return (
    <>
      <h3>Checks</h3>
      <table className="health">
        <thead>
          <tr>
            <th scope="col">Source</th>
            <th scope="col">Result</th>
            <th scope="col">Reason</th>
          </tr>
        </thead>
        <tbody>
          {reply.findings.map((finding, index) => (
            <tr key={`${finding.source}-${finding.url ?? ""}-${index}`}>
              <td title={finding.url ?? undefined}>{finding.source}</td>
              <td>
                <span className={`badge ${finding.result}`}>{RESULT_TEXT[finding.result]}</span>
              </td>
              <td>{finding.reason ?? "—"}</td>
            </tr>
          ))}
          {reply.skipped.map((row, index) => (
            <tr key={`skipped-${row.sourceId}-${index}`}>
              <td>{row.sourceId}</td>
              <td>
                <span className="badge skipped">skipped</span>
              </td>
              <td>{row.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Entities</h3>
      {reply.entities.length === 0 && <p>No entities.</p>}
      {[...byType].map(([type, entities]) => (
        <section key={type} aria-label={type}>
          <h4>
            {type} ({entities.length})
          </h4>
          <ul>
            {entities.map((entity) => (
              <li key={entity.id}>{entity.label}</li>
            ))}
          </ul>
        </section>
      ))}
      <h3>Links</h3>
      {reply.relations.length === 0 ? (
        <p>No links.</p>
      ) : (
        <ul className="edges">
          {reply.relations.map((relation) => (
            <li key={`${relation.from}-${relation.label}-${relation.to}`}>
              {labels.get(relation.from) ?? relation.from} — {relation.label.replaceAll("_", " ")} → {labels.get(relation.to) ?? relation.to}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function SourcesPanel({ client, healthVersion }: { client: AppClient; healthVersion: number }) {
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
  }, [refresh, healthVersion]);

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
