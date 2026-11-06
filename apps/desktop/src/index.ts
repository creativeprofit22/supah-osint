// Ring 4 (entry point): desktop shell. Talks to the app only through @supah-osint/rpc.
import type { Subject } from "@supah-osint/core";
import { createLocalRpc, type Rpc } from "@supah-osint/rpc";
import { badgeStyle } from "@supah-osint/ui";

export function startDesktop(): Rpc {
  return createLocalRpc({ sources: [], http: { get: async () => ({ status: 501, body: "" }) } });
}

export async function findingCountBadge(rpc: Rpc, subject: Subject): Promise<{ text: string; color: string }> {
  const findings = await rpc.findings(subject.id);
  return { text: String(findings.length), color: badgeStyle(findings.length > 0 ? "danger" : "accent").color };
}
