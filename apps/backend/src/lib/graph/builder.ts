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

/**
 * Which of these ids actually resolve to a record.
 *
 * 🔴 A LINK ROW IS NOT A RECORD, and until this existed the spines counted
 * link rows. Measured on the local database: one partner's `people` node said
 * "4 linked" against four link rows pointing at person ids that do not exist —
 * 21 people in the table, none of them those. Another's `submissions` said "2
 * raised" with both submissions gone. The node claimed `present`, which this
 * feature DEFINES as "a declared link with something on the other end", and
 * there was nothing on the other end.
 *
 * It surfaced only because the drawer's member list and the node's count
 * disagreed — the count came from the link table, the rows from the records.
 * A graph that contradicts itself about the one thing it exists to assert is
 * worse than either number alone.
 *
 * One extra query per node, run in parallel with its siblings. Deliberately
 * NOT done by expanding the target through the link's own fields
 * (`fields: ["person.id"]`): a `query.graph` hop from a link to its target can
 * come back with no key at all rather than an error, which would silently zero
 * EVERY count instead of correcting a few.
 */
export const resolveExisting = async (
  query: any,
  entity: string,
  ids: string[]
): Promise<string[]> => {
  if (!ids.length) {
    return []
  }
  const { data } = await query.graph({
    entity,
    filters: { id: ids },
    fields: ["id"],
  })
  const found = new Set(asArray<any>(data).map((r) => String(r.id)))
  // Preserve the caller's order; it is the link table's order.
  return ids.filter((id) => found.has(String(id)))
}
