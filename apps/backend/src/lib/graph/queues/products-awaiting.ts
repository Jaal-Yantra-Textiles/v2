import { GraphBuilder, asArray, resolveExisting } from "../builder"
import { runsAwaitingProduct, type RunLike } from "../spines/design/absence"
import type { Graph, GraphNode, NodeItem, SpineContext } from "../types"
import productDesignLink from "../../../links/product-design-link"

/**
 * "Products awaiting creation" — the first COHORT graph (#1856).
 *
 * Every spine so far centres on one record and asks which of its neighbours are
 * missing. This asks the same question of a whole population: which finished
 * work has no listing to sell it. That is the motivating absence of the entire
 * feature — `production_run.approved_product_id` is written on approval and
 * read by nothing, so a run that was never listed looks exactly like one that
 * was — except that until now you could only see it one design at a time, which
 * is no use for the thing it is actually for: working through the backlog.
 *
 * 🔴 IT SHARES THE DESIGN SPINE'S RULE, it does not restate it.
 * `runsAwaitingProduct` is imported, not reimplemented. A board that disagreed
 * with the design page about whether a run is owed a product would be the exact
 * fault this whole feature exists to remove, and a second copy of a predicate is
 * how that happens. Note the shared rule counts a run when it is FINISHED **or**
 * explicitly approved — the two states `approve-run-output` writes the product
 * id from. That is a small superset of "finished", and agreeing with the design
 * page is worth more than the narrower reading.
 *
 * ## Why a node is a DESIGN and not a run
 *
 * The decision is per design, not per run: three finished runs of one design
 * want one listing between them, and a node per run would ask the reader to
 * make the same decision three times. The runs are a count on the node and one
 * click away on its href.
 *
 * ## The state of a node is the whole point
 *
 *   absent  — nothing anywhere resembles a product for this design. The listing
 *             has to be created.
 *   derived — a product EXISTS and no run points at it: already linked to the
 *             design, or sitting on a revision of it, or approved out of a
 *             sibling run. `derived` is this codebase's word for "true only
 *             through another record", which is exactly the case.
 *
 * That second state is why this is worth building rather than filtering a list.
 * A list can say a run has no product. Only the neighbourhood can say that a
 * product for it is already sitting on its parent revision — which is the
 * difference between linking the listing that exists and minting a duplicate.
 */

/** How a candidate was reached. On the row, because it decides the action. */
type Provenance =
  | "linked to this design"
  | "on a revision of this design"
  | "approved from another run of this design"

type Candidate = {
  product_id: string
  provenance: Provenance
  /** The design it was reached through, when that is not this one. */
  via_design_id: string | null
}

/**
 * Nodes drawn at once.
 *
 * 🔴 Was 60, and 60 was WRONG — not marginally, uselessly. Rendered against the
 * real cohort it produced two dense columns of thirty at 35% zoom, where no
 * label could be read and the reader's only move was to zoom into one node at
 * a time. The API was correct and the board was worthless, which is a
 * distinction only a screenshot makes.
 *
 * A queue is a worklist, not an inventory. Eighteen fills the canvas at a
 * legible size, and the spine says how many are behind it.
 */
const CAP = 18

export const resolveProductsAwaiting = async ({
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
    fields: [
      "id",
      "status",
      "approval_decision",
      "approved_product_id",
      "design_id",
      "finished_at",
      "completed_at",
      "updated_at",
      "created_at",
    ],
  })

  const allRuns = asArray<any>(runRows)
  const awaiting = runsAwaitingProduct(allRuns as RunLike[]) as any[]

  const byDesign = new Map<string, any[]>()
  for (const r of awaiting) {
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
    return emptyGraph(awaiting.length, designIds.length)
  }

  const { data: designRows } = await query.graph({
    entity: "design",
    fields: ["id", "name", "status", "revised_from_id"],
    filters: { id: liveDesignIds },
  })
  const designs = new Map(asArray<any>(designRows).map((d) => [d.id, d]))

  /*
   * The revision neighbourhood: the design each was revised FROM, and the
   * designs revised from it. One hop each way — a product two revisions removed
   * is a much weaker claim than "link this one", and walking an unbounded chain
   * is a query per generation.
   */
  const { data: childRows } = await query.graph({
    entity: "design",
    fields: ["id", "name", "revised_from_id"],
    filters: { revised_from_id: liveDesignIds },
  })
  const children = asArray<any>(childRows)

  const lineage = new Map<string, string[]>()
  for (const id of liveDesignIds) {
    const rel = new Set<string>()
    const parent = designs.get(id)?.revised_from_id
    if (parent) rel.add(parent)
    for (const c of children) {
      if (c.revised_from_id === id && c.id) rel.add(c.id)
    }
    lineage.set(id, [...rel])
  }

  const lookupIds = [
    ...new Set([...liveDesignIds, ...[...lineage.values()].flat()]),
  ].filter(Boolean)

  const { data: productLinks } = await query.graph({
    entity: productDesignLink.entryPoint,
    fields: ["product_id", "design_id"],
    filters: { design_id: lookupIds },
  })
  const links = asArray<any>(productLinks)

  // Products already approved out of OTHER runs of the same design.
  const siblingProducts = new Map<string, Set<string>>()
  const liveSet = new Set(liveDesignIds)
  for (const r of allRuns) {
    if (!r.approved_product_id || !r.design_id || !liveSet.has(r.design_id)) continue
    siblingProducts.set(
      r.design_id,
      (siblingProducts.get(r.design_id) ?? new Set<string>()).add(r.approved_product_id)
    )
  }

  // A link row is not a record, and neither is an `approved_product_id`.
  const liveProductIds = new Set(
    await resolveExisting(query, "product", [
      ...new Set([
        ...links.map((l) => l.product_id),
        ...[...siblingProducts.values()].flatMap((s) => [...s]),
      ]),
    ].filter(Boolean))
  )

  const candidatesFor = (designId: string): Candidate[] => {
    const out: Candidate[] = []
    const seen = new Set<string>()
    const add = (id: string, provenance: Provenance, via: string | null) => {
      if (!id || !liveProductIds.has(id) || seen.has(id)) return
      seen.add(id)
      out.push({ product_id: id, provenance, via_design_id: via })
    }
    for (const l of links) {
      if (l.design_id === designId) add(l.product_id, "linked to this design", null)
    }
    for (const pid of siblingProducts.get(designId) ?? []) {
      add(pid, "approved from another run of this design", null)
    }
    for (const relId of lineage.get(designId) ?? []) {
      for (const l of links) {
        if (l.design_id === relId) add(l.product_id, "on a revision of this design", relId)
      }
    }
    return out
  }

  /*
   * Longest-waiting first, and the cap applies AFTER the sort — capping an
   * arbitrary order would draw eighteen designs chosen by nothing, and quietly
   * hide the one that has been finished and unsellable for a year behind
   * seventeen from last week.
   */
  const ordered = [...liveDesignIds].sort((a, b) => {
    const wa = daysSince(byDesign.get(a) ?? []) ?? -1
    const wb = daysSince(byDesign.get(b) ?? []) ?? -1
    if (wa !== wb) return wb - wa
    return (byDesign.get(b)?.length ?? 0) - (byDesign.get(a)?.length ?? 0)
  })

  const builder = new GraphBuilder("queue")

  for (const designId of ordered.slice(0, CAP)) {
    const design = designs.get(designId)
    const runs = byDesign.get(designId) ?? []
    const candidates = candidatesFor(designId)
    const waited = daysSince(runs)
    const n = candidates.length

    const node: GraphNode = {
      key: `design:${designId}`,
      type: "design_awaiting_product",
      label: design?.name || designId,
      sublabel: n
        ? `${n} product${n === 1 ? "" : "s"} already exist${n === 1 ? "s" : ""}`
        : `${runs.length} run${runs.length === 1 ? "" : "s"}, nothing to sell`,
      state: n ? "derived" : "absent",
      count: runs.length,
      status: design?.status ?? null,
      href: `/designs/${designId}/production-runs`,
      props: [
        { key: "runs awaiting", value: String(runs.length) },
        ...(waited != null
          ? [{ key: "waiting", value: `${waited} day${waited === 1 ? "" : "s"}` }]
          : []),
        ...(design?.status
          ? [{ key: "design status", value: String(design.status) }]
          : []),
        ...(n ? [{ key: "candidate products", value: String(n) }] : []),
      ],
      action: {
        label: n ? "Review the product that exists" : "Create the product",
        href: `/designs/${designId}/graph`,
      },
    }

    builder.push(node, {
      label: "approved_product_id",
      state: node.state,
      reason: n
        ? `Finished, and no run points at a product — but ${n === 1 ? "one exists" : "products exist"} already. Link rather than mint a second listing.`
        : "Finished work with no listing anywhere. Nothing can be sold from it.",
    })
  }

  return builder.build({
    key: "queue",
    type: "queue",
    label: "Products awaiting creation",
    sublabel: `${awaiting.length} finished run${awaiting.length === 1 ? "" : "s"} across ${liveDesignIds.length} design${liveDesignIds.length === 1 ? "" : "s"}`,
    state: "present",
    count: awaiting.length,
    status: null,
    href: null,
    props: [
      { key: "runs awaiting", value: String(awaiting.length) },
      { key: "designs", value: String(liveDesignIds.length) },
      ...(liveDesignIds.length > CAP
        ? [
            {
              key: "shown",
              value: `${CAP} of ${liveDesignIds.length}, longest waiting first`,
            },
          ]
        : []),
      /*
       * Said out loud rather than quietly dropped. A run naming a design that
       * no longer exists is itself worth knowing, and a queue whose total does
       * not match the nodes it draws is the kind of small lie that costs a
       * later session an afternoon.
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
    label: "Products awaiting creation",
    sublabel: runCount
      ? "every finished run names a design that no longer exists"
      : "nothing is waiting",
    state: "present",
    count: runCount,
    status: null,
    href: null,
    props: [
      { key: "runs awaiting", value: String(runCount) },
      { key: "designs named", value: String(namedDesigns) },
    ],
    action: null,
  })

/** Whole days since the most recent of these runs last moved. */
const daysSince = (runs: any[]): number | null => {
  const stamps = runs
    .map((r) => r.finished_at || r.completed_at || r.updated_at || r.created_at)
    .map((v) => (v ? new Date(v).getTime() : NaN))
    .filter((n) => Number.isFinite(n))
  return stamps.length ? Math.floor((Date.now() - Math.max(...stamps)) / 86_400_000) : null
}

/**
 * The candidate products behind one design node — the answer to "what already
 * exists", which is what decides whether this is a create or a link. Every row
 * says HOW it was reached, because a product on a parent revision and a product
 * already linked to this very design call for different actions.
 */
export const productsAwaitingItems = async (
  ctx: SpineContext,
  nodeKey: string
): Promise<NodeItem[]> => {
  const designId = nodeKey.startsWith("design:") ? nodeKey.slice("design:".length) : null
  if (!designId) return []

  const query = ctx.scope.resolve("query")

  const [{ data: ownLinks }, { data: designRows }, { data: runRows }, { data: childRows }] =
    await Promise.all([
      query.graph({
        entity: productDesignLink.entryPoint,
        fields: ["product_id", "design_id"],
        filters: { design_id: [designId] },
      }),
      query.graph({
        entity: "design",
        fields: ["id", "revised_from_id"],
        filters: { id: [designId] },
      }),
      query.graph({
        entity: "production_runs",
        fields: ["id", "approved_product_id"],
        filters: { design_id: [designId] },
      }),
      query.graph({
        entity: "design",
        fields: ["id", "name"],
        filters: { revised_from_id: [designId] },
      }),
    ])

  const parentId = asArray<any>(designRows)[0]?.revised_from_id ?? null
  const relatedIds = [parentId, ...asArray<any>(childRows).map((c) => c.id)].filter(
    Boolean
  ) as string[]

  const { data: relatedLinks } = relatedIds.length
    ? await query.graph({
        entity: productDesignLink.entryPoint,
        fields: ["product_id", "design_id"],
        filters: { design_id: relatedIds },
      })
    : { data: [] }

  const entries: Array<{ id: string; provenance: Provenance; via: string | null }> = []
  const seen = new Set<string>()
  const add = (id: string, provenance: Provenance, via: string | null) => {
    if (!id || seen.has(id)) return
    seen.add(id)
    entries.push({ id, provenance, via })
  }
  for (const l of asArray<any>(ownLinks)) add(l.product_id, "linked to this design", null)
  for (const r of asArray<any>(runRows)) {
    if (r.approved_product_id) {
      add(r.approved_product_id, "approved from another run of this design", null)
    }
  }
  for (const l of asArray<any>(relatedLinks)) {
    add(l.product_id, "on a revision of this design", l.design_id)
  }
  if (!entries.length) return []

  const live = new Set(
    await resolveExisting(
      query,
      "product",
      entries.map((e) => e.id)
    )
  )
  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "title", "status", "handle"],
    filters: { id: [...live] },
  })
  const byId = new Map(asArray<any>(products).map((p) => [p.id, p]))

  return entries
    .filter((e) => live.has(e.id))
    .map((e) => {
      const p = byId.get(e.id)
      return {
        id: e.id,
        label: p?.title || e.id,
        sublabel: e.provenance,
        status: p?.status ?? null,
        href: `/products/${e.id}`,
        props: [
          ...(p?.handle ? [{ key: "handle", value: String(p.handle) }] : []),
          ...(e.via ? [{ key: "via design", value: String(e.via) }] : []),
        ],
        /*
         * 🔴 No removal. These are CANDIDATES for this node, not members of it —
         * reached from a revision or a sibling run — and a "remove" here would
         * offer to unlink somebody else's listing from a design the reader is
         * not looking at.
         */
        remove: null,
      }
    })
}
