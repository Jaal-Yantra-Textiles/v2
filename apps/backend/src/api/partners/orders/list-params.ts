import type { PartnerOrderKind } from "./validators"

// #486 — the partner orders list (GET /partners/orders) used to forward ONLY
// `status` + `q` into the orders workflow, so every other filter the partner-UI
// sends (date ranges, region, sales channel) AND the sort dropdown were silently
// dropped → "the filters don't work". Admin's orders route honors all of these
// via `req.filterableFields` + `req.queryConfig.pagination.order`; we don't run
// that middleware (the `?kind=` discriminator must not reach the orders filters),
// so we map the same params here, by hand, in a pure + unit-testable helper.

// The field set the partner orders list is read with. Lives here, next to the
// param mapping, because it is part of the partner order-list *contract* rather
// than of any one route: the admin read-proxy (`GET /admin/partners/:id/orders`,
// #843) reads with exactly these fields so the inspection mirror cannot drift
// from what the partner actually sees.
//
// IMPORTANT: use the `relation.*` suffix syntax, not `*relation` prefix.
//
// `getOrdersListWorkflow` -> `useRemoteQueryStep` -> `query.graph` only
// understands `relation.*` (expand all fields of a relation). The
// `*relation` form is admin's user-facing convention, but the admin
// middleware (`validateAndTransformQuery` -> `prepareListQuery`) rewrites
// it to `relation.*` before handing it to the workflow — see
// node_modules/@medusajs/framework/.../get-query-config.js#prepareListQuery.
// We don't run that middleware here, so we have to write the canonical
// form ourselves.
//
// Symptom of getting this wrong: `customer`, `sales_channel`, and
// `shipping_address` all come back as `null` in the response and even
// their `_id` scalars get dropped — the orders list table renders blank
// cells for those columns.
export const PARTNER_ORDER_LIST_FIELDS = [
  "id", "status", "created_at", "email", "display_id",
  "custom_display_id", "payment_status", "fulfillment_status",
  "total", "currency_code",
  "customer_id",
  "sales_channel_id",
  "shipping_address_id",
  "customer.*",
  "sales_channel.*",
  "payment_collections.*",
  "shipping_address.*",
  // Chunk 5 (T3.4): kind is the route `?kind=` param (link-derived, Chunk 6).
  // Chunk 9b / PR-G + PR-H: the work-status badge reads the typed
  // `unified_order_status.partner_status` column (PR-F sidecar) via the link
  // accessor — now the SOLE source (PR-H retired the `metadata.partner_status`
  // copy and its transitional fallback).
  "unified_order_status.partner_status",
]

// Filters that apply to EVERY order row regardless of kind.
const UNIVERSAL_FILTER_KEYS = ["status", "q", "created_at", "updated_at"] as const

// Region / sales-channel are a retail concept. Design/inventory work-orders live
// in the internal PARTNER_WORK_ORDERS_CHANNEL and carry no region, so forwarding
// these for a work-order kind would filter every work-order out (empty table).
// They're only meaningful on the retail tab.
const RETAIL_ONLY_FILTER_KEYS = ["region_id", "sales_channel_id"] as const

export type PartnerOrderListParams = {
  baseFilters: Record<string, any>
  order: Record<string, "ASC" | "DESC">
  skip: number
  take: number
}

const isPresent = (v: unknown): boolean =>
  v !== undefined &&
  v !== null &&
  !(typeof v === "string" && v.trim() === "")

// Translate the UI's `order` query param (`-created_at`, `display_id`, …) into
// the remote-query order object (`{ created_at: "DESC" }`). Leading `-` = DESC.
// Unset / blank → newest-first (`-created_at`), matching the UI's own default —
// so design/inventory work-orders stop coming back in arbitrary DB order.
export function parseOrderParam(
  raw: unknown
): Record<string, "ASC" | "DESC"> {
  const str =
    typeof raw === "string" && raw.trim() ? raw.trim() : "-created_at"
  const desc = str.startsWith("-")
  const field = (desc ? str.slice(1) : str).trim()
  if (!field) {
    return { created_at: "DESC" }
  }
  return { [field]: desc ? "DESC" : "ASC" }
}

export function buildPartnerOrderListParams(
  query: Record<string, unknown> = {},
  kind: PartnerOrderKind = "retail"
): PartnerOrderListParams {
  const baseFilters: Record<string, any> = {}

  for (const key of UNIVERSAL_FILTER_KEYS) {
    if (isPresent(query[key])) {
      baseFilters[key] = query[key]
    }
  }

  if (kind === "retail") {
    for (const key of RETAIL_ONLY_FILTER_KEYS) {
      if (isPresent(query[key])) {
        baseFilters[key] = query[key]
      }
    }
  }

  const take = Number(query.limit) || 20
  const skip = Number(query.offset) || 0

  return {
    baseFilters,
    order: parseOrderParam(query.order),
    skip,
    take,
  }
}
