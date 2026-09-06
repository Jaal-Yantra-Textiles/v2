import type { EdgeState, Graph, GraphEdge, GraphNode, GraphSummary } from "./types"

/**
 * Node/edge accumulator shared by every spine.
 *
 * 🔴 Its one real job is the invariant that a node and its edge are added
 * TOGETHER. The prototype kept two arrays and pushed to both by hand at nine
 * call sites; a node pushed without its edge renders as an orphan box with no
 * line to the spine, and a `summary` counted off the edges would silently
 * disagree with what is on screen. Here it cannot happen: there is no way to
 * add one without the other.
 */
export class GraphBuilder {
  private readonly nodes: GraphNode[] = []
  private readonly edges: GraphEdge[] = []

  constructor(private readonly spineKey: string) {}

  /** Add a neighbour and the edge joining it to the spine. */
  push(node: GraphNode, edge: Omit<GraphEdge, "from" | "to">): void {
    this.nodes.push(node)
    this.edges.push({ from: this.spineKey, to: node.key, ...edge })
  }

  build(spine: GraphNode): Graph {
    return {
      spine,
      nodes: this.nodes,
      edges: this.edges,
      summary: summarise(this.edges),
      // Filled in by the registry, which is where the spine's declaration is.
      itemNodes: [],
    }
  }
}

/** Counted off the EDGES, which are what the canvas draws. */
export const summarise = (edges: GraphEdge[]): GraphSummary => ({
  links: edges.filter((e) => e.state === "present").length,
  absent: edges.filter((e) => e.state === "absent").length,
  derived: edges.filter((e) => e.state === "derived").length,
})

export const asArray = <T>(v: T | T[] | null | undefined): T[] =>
  Array.isArray(v) ? v.filter(Boolean) : v ? [v] : []

export const money = (v: unknown, currency?: string | null): string | null => {
  const n = typeof v === "string" ? Number(v) : (v as number)
  if (!Number.isFinite(n)) return null
  return `${(currency || "").toUpperCase()} ${Number(n).toLocaleString()}`.trim()
}

export type { EdgeState }
