/**
 * The shared vocabulary for entity graphs (#1847).
 *
 * Every spine — design, partner, order, inventory order, production run —
 * produces the same three things: a centre node, its neighbours, and the edges
 * between them. The types live here rather than beside any one spine so the
 * admin graph view and the MCP `get_entity_neighbours` tool read one contract
 * instead of two that drift.
 */

/**
 * present  — a declared link with something on the other end.
 * derived  — true only through a shared record (two hops), never a link file.
 * absent   — the model expects a neighbour here and there isn't one. A "future
 *            edge": it names the action that would create it.
 */
export type EdgeState = "present" | "derived" | "absent"

export type GraphProp = { key: string; value: string }

export type GraphNode = {
  key: string
  type: string
  label: string
  sublabel: string | null
  state: EdgeState
  count: number
  status: string | null
  href: string | null
  props: GraphProp[]
  /** Present only on an absent node: what would bring it into existence. */
  action: { label: string; href: string | null } | null
}

export type GraphEdge = {
  from: string
  to: string
  /** The real link field or column name — never "related to". */
  label: string
  state: EdgeState
  /** Why this edge is absent or derived. Null on a present edge. */
  reason: string | null
}

export type GraphSummary = {
  links: number
  absent: number
  derived: number
}

export type Graph = {
  spine: GraphNode
  nodes: GraphNode[]
  edges: GraphEdge[]
  summary: GraphSummary
}

/** What a spine resolver is handed. `scope` is the request container. */
export type SpineContext = {
  scope: any
  id: string
}

export type SpineDescriptor = {
  /** Registry key and the value of `spine.key` in the response. */
  key: string
  /** Human name, used in the not-found error. */
  label: string
  resolve: (ctx: SpineContext) => Promise<Graph>
}
