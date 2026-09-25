import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { getOrdersListWorkflow } from "@medusajs/core-flows"
import { listAdminOrders } from "../../../lib/work-orders/admin-order-reads"
import { workOrderReadsEnabled } from "../../../lib/work-orders/read-work-orders"
import { AdminGetOrdersKindParam, AdminOrderKind } from "./validators"

// Chunk 4 (T3.3, #342): override the built-in admin orders LIST so /admin/orders
// reads as a *customer retail* list again, hiding the unified work-orders
// (kind=design / kind=inventory) that now share the `order` table (D5).
//
// Mechanism: a project route file at this exact path overrides the core handler
// (routes-loader: last-registered wins; project src/api is scanned after core).
// Core's `validateAndTransformQuery` middleware still runs, so `req.queryConfig`
// + `req.filterableFields` are populated when this handler runs. We translate
// `?kind=` into an `id` constraint and hand the (otherwise untouched) variables
// to the SAME built-in workflow — so computed totals, pagination, q-search, and
// every existing filter keep working exactly as before.
//
//   (unset) | retail → exclude both work-order kinds   (id $nin work-orders)
//   design           → only design work-orders         (id $in design orders)
//   inventory        → only raw-material POs            (id $in inventory orders)
//   all              → no link filter (pre-D5 behaviour)
//
// Work-order order-ids are resolved by the authoritative forward link
// (`<entity>.order.id`, the join Chunk 3 standardised on), with the transitional
// `metadata.unified_order_id` backref as a fallback for pre-D5-2 (link-less)
// rows — same shape as resolveUnifiedOrderIdByLink. The index `$ne: null`
// join-null filter is deliberately avoided (only the `id: null` anti-join was
// verified in D5-1); query.graph is authoritative anyway, which a list tolerates.

const PAGE = 1000

// Collect every unified-order id reachable from a legacy execution table, paged.
export const collectLinkedOrderIds = async (
  query: any,
  entity: "production_runs" | "inventory_orders"
): Promise<string[]> => {
  const ids: string[] = []
  for (let skip = 0; ; skip += PAGE) {
    const { data } = await query.graph({
      entity,
      fields: ["id", "order.id", "metadata"],
      pagination: { skip, take: PAGE },
    })
    for (const row of data ?? []) {
      // #2029 item 5 — the link only; the `metadata.unified_order_id` fallback
      // is retired (prod: 0 rows depend on it, nothing writes a new one).
      const orderId = row?.order?.id
      if (orderId) {
        ids.push(orderId)
      }
    }
    if (!data || data.length < PAGE) {
      break
    }
  }
  return ids
}

/**
 * The `metadata.legacy_id` prefix each mirror stamps on the order it projects.
 * `dual-write-unified-order.ts` writes the inventory one, and
 * `dual-write-unified-run-order.ts` the run one — both as PROTECTED keys that
 * no external writer may overwrite.
 */
export const MIRROR_LEGACY_ID_PREFIX = {
  design: "prod_run_",
  inventory: "inv_order_",
} as const

/**
 * 🔴 The work-orders whose EXECUTION ROW IS GONE.
 *
 * `collectLinkedOrderIds` walks the execution table and reads `order.id` off
 * each row, so it can only ever see work orders whose execution row still
 * exists. Delete an inventory order and its core mirror survives with nothing
 * pointing at it — it is collected by nobody, excluded from nothing, and the
 * classifier's default hands it to RETAIL. An inventory purchase order starts
 * reading as a customer sale.
 *
 * That is live on production: `order_01M231KWSJGQS2V5AMDBDXGNEH` (#107, ₹14,000)
 * is one of EIGHT retail orders, and `inv_order_01M231KWG9CG5VQJHXCS36T0YH` —
 * the id its own metadata still names — 404s.
 *
 * The order never stopped saying what it was. #2029 item 5 retired the
 * `metadata.unified_order_id` backref on the reasoning that "prod: 0 rows
 * depend on it", which was true of THAT key and read as true of the whole blob.
 * `legacy_id` is a different key, is still written by both dual-writes today,
 * and `use-order-kind` consumers already read it (see the note at
 * dual-write-unified-run-order.ts:524). An empty link read is indistinguishable
 * from "nothing linked", and believing it inverts the answer silently.
 *
 * So the link stays authoritative and this is strictly additive: it can only
 * pull an order OUT of retail, never push one in. Measured on production before
 * shipping — of the 8 orders then classified retail, exactly ONE carried a
 * `legacy_id`, and the other seven carried none.
 *
 * ⚠️ NOT the `unified_order_kind` sidecar, which looks like the typed answer and
 * is not: its enum is `collated | per_run` (#826), which says how a work order
 * is SHAPED, not which family it belongs to. It cannot separate an inventory
 * purchase order from a customer sale, so it cannot decide this.
 */
export const collectMirrorOrderIdsByMetadata = async (
  query: any,
  kind: Exclude<AdminOrderKind, "all" | "retail">
): Promise<string[]> => {
  const prefix = MIRROR_LEGACY_ID_PREFIX[kind]
  const ids: string[] = []
  for (let skip = 0; ; skip += PAGE) {
    const { data } = await query.graph({
      entity: "orders",
      fields: ["id", "metadata"],
      pagination: { skip, take: PAGE },
    })
    for (const row of data ?? []) {
      const legacyId = row?.metadata?.legacy_id
      if (typeof legacyId === "string" && legacyId.startsWith(prefix)) {
        ids.push(row.id)
      }
    }
    if (!data || data.length < PAGE) {
      break
    }
  }
  return ids
}

/**
 * Every order of one work-order kind: those still linked to a live execution
 * row, plus those whose execution row is gone but whose own metadata still
 * names it.
 *
 * Best-effort on the metadata half deliberately. The link is the contract; the
 * blob is a safety net, and a graph hiccup reading it must degrade to today's
 * behaviour rather than empty the list.
 */
export const collectWorkOrderIds = async (
  query: any,
  kind: Exclude<AdminOrderKind, "all" | "retail">
): Promise<string[]> => {
  const entity = kind === "design" ? "production_runs" : "inventory_orders"
  const linked = await collectLinkedOrderIds(query, entity)
  let orphaned: string[] = []
  try {
    orphaned = await collectMirrorOrderIdsByMetadata(query, kind)
  } catch {
    orphaned = []
  }
  return Array.from(new Set([...linked, ...orphaned]))
}

// Resolve the order-id set the requested kind constrains the list to.
const resolveKindOrderIds = async (
  query: any,
  kind: Exclude<AdminOrderKind, "all">
): Promise<string[]> => {
  if (kind === "design") {
    return collectWorkOrderIds(query, "design")
  }
  if (kind === "inventory") {
    return collectWorkOrderIds(query, "inventory")
  }
  // retail: union of both work-order kinds, to be excluded.
  const [runs, invs] = await Promise.all([
    collectWorkOrderIds(query, "design"),
    collectWorkOrderIds(query, "inventory"),
  ])
  return Array.from(new Set([...runs, ...invs]))
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query: any = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // `kind` is not a filterable order field — read+validate it off the raw query
  // and keep it out of the workflow filters.
  const { kind } = AdminGetOrdersKindParam.parse({
    kind: (req.query as Record<string, unknown>)?.kind,
  })
  const resolved: AdminOrderKind = kind ?? "retail"

  const filters: Record<string, any> = {
    ...req.filterableFields,
    is_draft_order: false,
  }

  // #2264 S2b — work orders come from `work_order`, retail from core. Every
  // row a work order returns already carries `unified_order_status`.
  if (workOrderReadsEnabled()) {
    const { skip, take, order } = (req.queryConfig.pagination ?? {}) as any
    return res.json(
      await listAdminOrders(req.scope, {
        kind: resolved,
        filters,
        fields: req.queryConfig.fields,
        skip: Number(skip ?? 0),
        take: Number(take ?? 50),
        order,
      })
    )
  }

  if (resolved !== "all") {
    const ids = await resolveKindOrderIds(query, resolved)
    const constraint = resolved === "retail" ? { $nin: ids } : { $in: ids }

    if (filters.id !== undefined) {
      // Preserve a caller-supplied id filter by intersecting via $and.
      const callerId = filters.id
      delete filters.id
      filters.$and = [...(filters.$and ?? []), { id: callerId }, { id: constraint }]
    } else {
      filters.id = constraint
    }
  }

  const { result } = await getOrdersListWorkflow(req.scope).run({
    input: {
      fields: req.queryConfig.fields,
      variables: {
        filters,
        ...req.queryConfig.pagination,
      },
    },
  })

  const { rows, metadata } = result as any

  // #403 (slice 2): surface the work-status on the admin LIST the same way the
  // detail route does. `unified_order_status.partner_status` is a custom link
  // sidecar the core order query config does not expand, so attach it via a
  // single best-effort query.graph over the returned ids and merge per row —
  // never force a custom link field into core's list workflow (which validates
  // fields against the order query-config schema). A graph hiccup just leaves
  // the rows without work-status (retail rendering), never breaks the list.
  try {
    const ids = (rows ?? []).map((r: any) => r.id).filter(Boolean)
    if (ids.length) {
      const { data } = await query.graph({
        entity: "orders",
        fields: ["id", "unified_order_status.partner_status"],
        filters: { id: ids },
      })
      const statusById = new Map<string, any>(
        (data ?? []).map((o: any) => [o.id, o.unified_order_status])
      )
      for (const row of rows) {
        if (statusById.has(row.id)) {
          row.unified_order_status = statusById.get(row.id)
        }
      }
    }
  } catch {
    // leave rows as-is; the list falls back to retail rendering
  }

  res.json({
    orders: rows,
    count: metadata.count,
    offset: metadata.skip,
    limit: metadata.take,
  })
}
