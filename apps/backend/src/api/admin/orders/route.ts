import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { getOrdersListWorkflow } from "@medusajs/core-flows"
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
const collectLinkedOrderIds = async (
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
      const orderId = row?.order?.id ?? row?.metadata?.unified_order_id
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

// Resolve the order-id set the requested kind constrains the list to.
const resolveKindOrderIds = async (
  query: any,
  kind: Exclude<AdminOrderKind, "all">
): Promise<string[]> => {
  if (kind === "design") {
    return collectLinkedOrderIds(query, "production_runs")
  }
  if (kind === "inventory") {
    return collectLinkedOrderIds(query, "inventory_orders")
  }
  // retail: union of both work-order kinds, to be excluded.
  const [runs, invs] = await Promise.all([
    collectLinkedOrderIds(query, "production_runs"),
    collectLinkedOrderIds(query, "inventory_orders"),
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
