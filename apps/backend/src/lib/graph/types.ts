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
  /**
   * A job this node can RUN, as opposed to a page it can send you to.
   *
   * 🔴 The gap this closes (#1856 → #1857). Until now a node had exactly two
   * affordances: a registered create/edit form, or `action` — a LINK. That is
   * enough for a spine whose absences are records somebody fills in, and it is
   * nothing at all for a node whose answer is an operation: compact these
   * markers, re-run this sweep, reconcile these balances. The partner spine
   * has been carrying four cards drawn `derived` for exactly this reason —
   * verify, provision, apply — and the dangling board cannot exist without it,
   * because a board that can only report is the report it was meant to replace.
   *
   * OPTIONAL, deliberately: four spines already build `GraphNode` literals by
   * hand and a required field would make adding an affordance a rename across
   * all of them. Absent means "this node runs nothing", which is the truth for
   * every node that predates this.
   */
  act?: NodeAct | null
}

/**
 * A two-press operation offered on a node: preview, then apply.
 *
 * Modelled on `NodeItemRemoval` and for the same reason — the SERVER builds
 * the path and both bodies, and the client sends them verbatim. A client that
 * assembled a call to `/admin/ops/maintenance-jobs/:id/run` would be choosing,
 * from the browser, which job runs and whether it writes.
 *
 * 🔴 The two bodies are separate fields rather than one body plus a flag. A
 * single body the client mutates to flip `dry_run` is one typo away from
 * applying what the reader asked to preview, and that typo is invisible in
 * review. Here the destructive call is a different value, named as such,
 * chosen by a different press.
 */
export type NodeAct = {
  method: "POST"
  path: string
  /** The safe call. For a maintenance job this carries `dry_run: true`. */
  previewBody: Record<string, unknown> | null
  /**
   * The call that writes, or NULL where the act has nothing to apply — a
   * read-only job like the sweep itself. Null must render no apply button at
   * all rather than a disabled one: a greyed-out "Apply" implies a write that
   * is merely unavailable, when in fact there is none.
   */
  applyBody: Record<string, unknown> | null
  label: string
  /**
   * What the reader is told before the apply press. Empty where `applyBody`
   * is null and nothing is being confirmed.
   */
  confirm: string
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

/**
 * One MEMBER of a node.
 *
 * A node is an aggregate — "Inventory, 4 items". That is the right thing on the
 * canvas, where the subject is which edges exist. But it is the wrong thing in
 * the drawer, which is where the reader has already asked "which four?", and it
 * makes REMOVAL impossible: you cannot unlink an aggregate.
 *
 * 🔴 Members are fetched LAZILY, per node, not folded into the graph payload.
 * The design spine already makes seven round trips to build a dozen aggregate
 * nodes; expanding every one of them into its rows would multiply that by the
 * row count for a drawer the reader may never open. The canvas stays cheap and
 * the drawer pays for what it shows.
 */
export type NodeItem = {
  /** The RECORD's id — never the link row's, unless `remove` says otherwise. */
  id: string
  label: string
  sublabel: string | null
  status: string | null
  href: string | null
  props: GraphProp[]
  /** How to detach this member, or null where the model forbids it. */
  remove: NodeItemRemoval | null
}

/**
 * How to remove one member.
 *
 * 🔴 This names an EXISTING admin endpoint rather than carrying its own
 * unlink logic. Every one of these routes already exists, is already tested,
 * and already runs the compensating workflow — `DELETE
 * /admin/designs/:id/components/:componentId`, `POST
 * /admin/designs/:id/inventory/delink`, and so on. Re-implementing detachment
 * inside the graph would give each of them a SECOND HOME, which is the failure
 * this codebase has hit every time the same logic acquired one.
 *
 * `path` is absolute and server-built, so the client never assembles a URL out
 * of ids it half-understands.
 */
export type NodeItemRemoval = {
  method: "DELETE" | "POST"
  path: string
  /**
   * Sent as the JSON body, or null where the route needs none.
   *
   * 🔴 Not "null on a DELETE". `DELETE /admin/partners/:id/people` takes
   * `{ person_ids }` — the admin's own unlink hook has always sent it that
   * way, and the client here forwards `body` on whatever method is named. The
   * shape of the existing route decides this, not the verb.
   */
  body: Record<string, unknown> | null
  /** The words on the button. "Remove", "Unlink", "Cancel assignment". */
  label: string
  /**
   * What the reader is told before it happens. 🔴 Required: several of these
   * are not symmetric with the create form beside them — delinking inventory
   * releases reserved stock, cancelling a partner assignment notifies them.
   */
  confirm: string
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
  /**
   * The node keys whose members can be listed.
   *
   * 🔴 The client must be TOLD this rather than inferring it. The obvious
   * inference — "fetch members whenever `count > 0`" — is wrong on exactly the
   * nodes that are a single record: `product` has a count of 1 and no member
   * list, so it would fetch, get `[]` back, and render "no items" under a node
   * that is a real, present product. Declared here, the drawer asks only where
   * asking means something.
   *
   * Attached by the registry from the spine's own declaration, so no spine has
   * to remember to put it on the graph it builds.
   */
  itemNodes: string[]
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
  /**
   * The members behind one aggregate node, if this spine can list them.
   *
   * Optional on purpose: a spine is useful the moment it can draw its edges,
   * and demanding an item resolver up front would make every new spine a
   * bigger change than the registry is trying to make it. A spine without one
   * — or a node the resolver does not know — yields an EMPTY LIST, and the
   * drawer says so rather than rendering a bare panel.
   */
  items?: (ctx: SpineContext, nodeKey: string) => Promise<NodeItem[]>
  /** Node keys `items` can answer for. Surfaced to the client as `itemNodes`. */
  itemNodes?: string[]
}
