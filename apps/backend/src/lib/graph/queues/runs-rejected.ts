import { GraphBuilder, asArray, resolveExisting } from "../builder"
import { runsRejected, type RunLike } from "../spines/design/absence"
import type { Graph, GraphNode, NodeItem, SpineContext } from "../types"

/**
 * "Rejected production runs" — the second COHORT graph.
 *
 * `approval_decision` is a SEPARATE AXIS from `status`, and that separation is
 * why this board has to exist: a rejected run stays `completed`, because the
 * work WAS done and the partner is still owed for it, so every status-based
 * view — the run lists, the filters, the run's own page — shows a rejected run
 * exactly like an approved one. The decision is recorded and read by nothing
 * that keys on status. Production holds ten rejected runs across five designs
 * at the time of writing, every one of them reading as plain `completed`.
 *
 * 🔴 IT SHARES THE DESIGN SPINE'S RULE, it does not restate it.
 * `runsRejected` is imported, not reimplemented. A board that disagreed with
 * the design page about whether a run was rejected would be the exact fault
 * this whole feature exists to remove, and a second copy of a predicate is how
 * that happens.
 *
 * ## Why a node is a DESIGN and not a run
 *
 * The decision is per design, not per run: what to do about rejected output —
 * re-run it, adjust the design, write it off — is one question per design,
 * and a node per run would ask the reader to answer it once per run. The runs
 * are a count on the node and one click away on its href.
 *
 * ## Why every edge is PRESENT
 *
 * The first cohort board draws an absence — a product that should exist and
 * doesn't. This one surfaces a recorded FACT that no status-based view can
 * show: the rejection is the edge, and it is there. The absence this board
 * removes is in the reader's view, not in the data, so the nodes are `present`
 * and carry no action — there is nothing to bring into existence, only work
 * to decide on.
 */

/**
 * Nodes drawn at once. Eighteen, as on `products-awaiting`: a queue is a
 * worklist, not an inventory, and the spine says how many are behind the cap.
 */
const CAP = 18

export const resolveRunsRejected = async ({
  scope,
}: SpineContext): Promise<Graph> => {
  const query = scope.resolve("query")

  /*
   * Every run, then the shared predicate. Filtering in the query would mean
   * encoding the rule in a `filters` object here as well as in `absence.ts` —
   * a second copy of the very thing this file exists not to copy.
   */
  const { data: runRows } = await query.graph({
    entity: "production_runs",
    fields: ["id", "approval_decision", "rejected_quantity", "design_id"],
  })

  const rejected = runsRejected(asArray<any>(runRows) as RunLike[]) as any[]

  const byDesign = new Map<string, any[]>()
  for (const r of rejected) {
    if (!r.design_id) continue
    byDesign.set(r.design_id, [...(byDesign.get(r.design_id) ?? []), r])
  }
  const designIds = [...byDesign.keys()]

  /*
   * 🔴 A run's `design_id` is a plain column, not a link, so it can outlive the
   * design it names. Resolve before drawing: a node for a design that does not
   * exist is a queue item nobody can ever action, and this feature has already
   * been bitten once by counting references instead of records (#1857).
   */
  const liveDesignIds = await resolveExisting(query, "design", designIds)
  if (!liveDesignIds.length) {
    return emptyGraph(rejected.length, designIds.length)
  }

  const { data: designRows } = await query.graph({
    entity: "design",
    fields: ["id", "name", "status"],
    filters: { id: liveDesignIds },
  })
  const designs = new Map(asArray<any>(designRows).map((d) => [d.id, d]))

  /*
   * Most rejected output first, and the cap applies AFTER the sort — capping an
   * arbitrary order would draw eighteen designs chosen by nothing. Ordered by
   * what is at stake rather than by age: the board's rule has no timestamp, so
   * the designs with the most rejected units lead, and run count breaks ties.
   */
  const ordered = [...liveDesignIds].sort((a, b) => {
    const ua = rejectedUnits(byDesign.get(a) ?? [])
    const ub = rejectedUnits(byDesign.get(b) ?? [])
    if (ua !== ub) return ub - ua
    return (byDesign.get(b)?.length ?? 0) - (byDesign.get(a)?.length ?? 0)
  })

  const builder = new GraphBuilder("queue")

  for (const designId of ordered.slice(0, CAP)) {
    const design = designs.get(designId)
    const runs = byDesign.get(designId) ?? []
    const units = rejectedUnits(runs)

    const node: GraphNode = {
      key: `design:${designId}`,
      type: "design_rejected_runs",
      label: design?.name || designId,
      sublabel: `${runs.length} rejected run${runs.length === 1 ? "" : "s"}${
        units ? `, ${units} unit${units === 1 ? "" : "s"} rejected` : ""
      }`,
      state: "present",
      count: runs.length,
      status: design?.status ?? null,
      href: `/designs/${designId}/production-runs`,
      props: [
        { key: "rejected runs", value: String(runs.length) },
        ...(units ? [{ key: "units rejected", value: String(units) }] : []),
        ...(design?.status
          ? [{ key: "design status", value: String(design.status) }]
          : []),
      ],
      action: null,
    }

    builder.push(node, {
      label: "approval_decision",
      state: "present",
      reason: null,
    })
  }

  return builder.build({
    key: "queue",
    type: "queue",
    label: "Rejected production runs",
    sublabel: `${rejected.length} rejected run${rejected.length === 1 ? "" : "s"} across ${liveDesignIds.length} design${liveDesignIds.length === 1 ? "" : "s"}`,
    state: "present",
    count: rejected.length,
    status: null,
    href: null,
    props: [
      { key: "rejected runs", value: String(rejected.length) },
      { key: "designs", value: String(liveDesignIds.length) },
      ...(liveDesignIds.length > CAP
        ? [
            {
              key: "shown",
              value: `${CAP} of ${liveDesignIds.length}, most rejected output first`,
            },
          ]
        : []),
      /*
       * Said out loud rather than quietly dropped, for the same reason as on
       * `products-awaiting`: a queue whose total does not match the nodes it
       * draws is the kind of small lie that costs a later session an afternoon.
       */
      ...(designIds.length !== liveDesignIds.length
        ? [
            {
              key: "skipped",
              value: `${designIds.length - liveDesignIds.length} design(s) named by a run no longer exist`,
            },
          ]
        : []),
    ],
    action: null,
  })
}

const emptyGraph = (runCount: number, namedDesigns: number): Graph =>
  new GraphBuilder("queue").build({
    key: "queue",
    type: "queue",
    label: "Rejected production runs",
    sublabel: runCount
      ? "every rejected run names a design that no longer exists"
      : "nothing has been rejected",
    state: "present",
    count: runCount,
    status: null,
    href: null,
    props: [
      { key: "rejected runs", value: String(runCount) },
      { key: "designs named", value: String(namedDesigns) },
    ],
    action: null,
  })

/** Total units rejected across these runs. */
const rejectedUnits = (runs: any[]): number =>
  runs.reduce((sum, r) => sum + (Number(r.rejected_quantity) || 0), 0)

/**
 * The rejected runs behind one design node — the answer to "which runs",
 * which a count can never give. Every row carries the run's STATUS beside its
 * rejection, because the two axes being separate is the whole reason this
 * board exists: the badge says completed, the row says rejected, and only
 * together do they say what actually happened.
 */
export const runsRejectedItems = async (
  ctx: SpineContext,
  nodeKey: string
): Promise<NodeItem[]> => {
  const designId = nodeKey.startsWith("design:") ? nodeKey.slice("design:".length) : null
  if (!designId) return []

  const query = ctx.scope.resolve("query")

  const { data: runRows } = await query.graph({
    entity: "production_runs",
    fields: ["id", "status", "approval_decision", "rejected_quantity"],
    filters: { design_id: [designId] },
  })

  /*
   * The shared predicate, not a local filter: the drawer's rows must be the
   * same runs the node counted, and a second definition of "rejected" is how
   * the board and the design page would come to disagree.
   */
  const rejected = runsRejected(asArray<any>(runRows) as RunLike[]) as any[]

  return rejected.map((r) => ({
    id: String(r.id),
    label: String(r.id),
    sublabel:
      r.rejected_quantity != null
        ? `${r.rejected_quantity} unit${Number(r.rejected_quantity) === 1 ? "" : "s"} rejected`
        : "output rejected",
    status: r.status ? String(r.status) : null,
    href: `/designs/${designId}/production-runs`,
    props: [
      { key: "status", value: String(r.status ?? "—") },
      { key: "approval decision", value: String(r.approval_decision ?? "—") },
      ...(r.rejected_quantity != null
        ? [{ key: "rejected quantity", value: String(r.rejected_quantity) }]
        : []),
    ],
    /*
     * 🔴 No removal. A rejection is a DECISION, not a link — there is nothing
     * to detach, and un-rejecting a run is a state change on its output
     * review with consequences of its own, which belongs to that route and
     * not to a row action on a board.
     */
    remove: null,
  }))
}
