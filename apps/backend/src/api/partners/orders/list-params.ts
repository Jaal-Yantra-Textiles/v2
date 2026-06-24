import type { PartnerOrderKind } from "./validators"

// #486 — the partner orders list (GET /partners/orders) used to forward ONLY
// `status` + `q` into the orders workflow, so every other filter the partner-UI
// sends (date ranges, region, sales channel) AND the sort dropdown were silently
// dropped → "the filters don't work". Admin's orders route honors all of these
// via `req.filterableFields` + `req.queryConfig.pagination.order`; we don't run
// that middleware (the `?kind=` discriminator must not reach the orders filters),
// so we map the same params here, by hand, in a pure + unit-testable helper.

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
