// Ring 4 (entry point): desktop shell. Talks to the app only through @supah-osint/rpc.
import type { Audit } from "@supah-osint/core";
import { createLocalRpc, type Rpc } from "@supah-osint/rpc";
import { badgeStyle } from "@supah-osint/ui";

export function startDesktop(): Rpc {
  return createLocalRpc({ sources: [], http: { get: async () => ({ status: 501, body: "" }) } });
}

export async function findingCountBadge(rpc: Rpc, audit: Audit): Promise<{ text: string; color: string }> {
  // Only real hits count; not_found and inconclusive must not show as exposure.
  const found = (await rpc.findings(audit.id)).filter((finding) => finding.result === "found");
  return { text: String(found.length), color: badgeStyle(found.length > 0 ? "danger" : "accent").color };
}
