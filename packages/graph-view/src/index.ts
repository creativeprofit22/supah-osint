// Ring 4 (entry point): turns findings into graph nodes and edges for display.
import { entityId, mergeGraph, type Finding } from "@supah-osint/core";
import { tokens } from "@supah-osint/ui-tokens";

export type GraphNode = { id: string; label: string; color: string };
export type GraphEdge = { from: string; to: string; label: string };

export function toGraph(findings: readonly Finding[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const { entities, relations } = mergeGraph(findings);
  const nodes = entities.map((entity) => ({
    id: entityId(entity),
    label: entity.key,
    color: entity.type === "Person" ? tokens.color.accent : tokens.color.text,
  }));
  const edges = relations.map((relation) => ({ from: relation.from, to: relation.to, label: relation.label }));
  return { nodes, edges };
}
