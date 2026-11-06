// Ring 4 (entry point): turns findings into graph nodes and edges for display.
import type { Finding } from "@supah-osint/core";
import { tokens } from "@supah-osint/ui-tokens";

export type GraphNode = { id: string; label: string; color: string };
export type GraphEdge = { from: string; to: string };

export function toGraph(findings: readonly Finding[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  for (const finding of findings) {
    nodes.set(finding.subjectId, { id: finding.subjectId, label: finding.subjectId, color: tokens.color.accent });
    nodes.set(finding.url, { id: finding.url, label: finding.source, color: tokens.color.text });
    edges.push({ from: finding.subjectId, to: finding.url });
  }
  return { nodes: [...nodes.values()], edges };
}
