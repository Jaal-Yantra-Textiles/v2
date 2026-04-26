/**
 * GET /admin/abandoned-carts
 *
 * Lists carts that were created in the storefront but never converted into
 * an order. Backed by the native Cart Module via `query.graph` — same
 * pattern used elsewhere in this codebase (see google-merchant/accounts,
 * production-runs). All filters, ordering and pagination are pushed to
 * the database so `metadata.count` is the authoritative total.
 *
 * Tier semantics (translated to DB predicates):
 *   all          completed_at IS NULL
 *   has_items    + at least one cart line item exists
 *   recoverable  + (email IS NOT NULL OR customer_id IS NOT NULL)
 *   checkout     + shipping_address_id IS NOT NULL
 *
 * Empty/dead carts (no items, idle > 24h) live in tier=all only — they
 * exist for cleanup, not recovery.
 */

import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { ListAbandonedCartsQuery } from "./validators"

const CART_FIELDS = [
  "id",
  "email",
  "customer_id",
  "region_id",
  "sales_channel_id",
  "currency_code",
  "completed_at",
  "created_at",
  "updated_at",
  "metadata",
  "shipping_address_id",
  "items.id",
  "items.title",
  "items.quantity",
  "items.unit_price",
  "items.thumbnail",
  "items.product_id",
  "items.variant_id",
  "shipping_address.id",
  "customer.id",
  "customer.email",
  "customer.first_name",
  "customer.last_name",
  "customer.phone",
  "region.id",
  "region.name",
  "sales_channel.id",
  "sales_channel.name",
] as const

// Translate `?order=-updated_at` / `+created_at` / `created_at` into the
// `{ updated_at: "DESC" }` shape that query.graph wants.
const parseOrderParam = (raw?: string): Record<string, "ASC" | "DESC"> => {
  const fallback: Record<string, "ASC" | "DESC"> = { updated_at: "DESC" }
  if (!raw) return fallback
  const trimmed = raw.trim()
  if (!trimmed) return fallback
  const dir: "ASC" | "DESC" = trimmed.startsWith("-") ? "DESC" : "ASC"
  const field = trimmed.replace(/^[-+]/, "")
  const ALLOWED = new Set(["updated_at", "created_at"])
  if (!ALLOWED.has(field)) return fallback
  return { [field]: dir }
}

export async function GET(
  req: AuthenticatedMedusaRequest<ListAbandonedCartsQuery>,
  res: MedusaResponse,
): Promise<void> {
  const validated = (req as any).validatedQuery as ListAbandonedCartsQuery
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any

  const idleCutoff = new Date(Date.now() - validated.idle_minutes * 60 * 1000)

  // ── DB-side filter assembly ────────────────────────────────────────────────
  // We start with the equality filters that always apply, then layer tier and
  // text-search predicates as nested `$and` so they don't trample each other.
  const filters: Record<string, any> = {
    completed_at: null,
    updated_at: { $lt: idleCutoff },
  }

  if (validated.sales_channel_id) filters.sales_channel_id = validated.sales_channel_id
  if (validated.region_id) filters.region_id = validated.region_id
  if (validated.customer_id) filters.customer_id = validated.customer_id
  if (validated.email) filters.email = validated.email

  const andClauses: Array<Record<string, any>> = []

  // Tier predicates
  switch (validated.tier) {
    case "all":
      // No additional predicate.
      break
    case "has_items":
      // At least one line item linked. `items.id: { $ne: null }` forces the
      // join and excludes carts with zero items.
      andClauses.push({ items: { id: { $ne: null } } })
      break
    case "recoverable":
      andClauses.push({ items: { id: { $ne: null } } })
      andClauses.push({
        $or: [
          { email: { $ne: null } },
          { customer_id: { $ne: null } },
        ],
      })
      break
    case "checkout":
      andClauses.push({ items: { id: { $ne: null } } })
      andClauses.push({
        $or: [
          { email: { $ne: null } },
          { customer_id: { $ne: null } },
        ],
      })
      andClauses.push({ shipping_address_id: { $ne: null } })
      break
  }

  // Free-text search across cart id and email. Customer name search is left
  // out — it requires a join the simple `$or` can't express; users can use
  // the customer_id filter directly when they need that.
  if (validated.q) {
    const q = validated.q.trim()
    if (q) {
      andClauses.push({
        $or: [
          { id: { $ilike: `%${q}%` } },
          { email: { $ilike: `%${q}%` } },
        ],
      })
    }
  }

  if (andClauses.length > 0) {
    filters.$and = andClauses
  }

  // ── Query ──────────────────────────────────────────────────────────────────
  const { data: carts, metadata } = await query.graph({
    entity: "cart",
    fields: CART_FIELDS as unknown as string[],
    filters,
    pagination: {
      skip: validated.offset,
      take: validated.limit,
      order: parseOrderParam(validated.order),
    },
  })

  const list = (carts as any[]) || []

  const enriched = list.map((cart) => {
    const items = Array.isArray(cart.items) ? cart.items : []
    const itemsCount = items.reduce((sum: number, i: any) => sum + (i.quantity || 0), 0)
    const subtotal = items.reduce(
      (sum: number, i: any) => sum + (Number(i.unit_price) || 0) * (i.quantity || 0),
      0,
    )

    return {
      id: cart.id,
      email: cart.email ?? null,
      currency_code: cart.currency_code,
      created_at: cart.created_at,
      updated_at: cart.updated_at,
      idle_minutes: Math.max(
        0,
        Math.round((Date.now() - new Date(cart.updated_at).getTime()) / 60000),
      ),
      items_count: itemsCount,
      items_subtotal: subtotal,
      items_preview: items.slice(0, 3).map((i: any) => ({
        id: i.id,
        title: i.title,
        quantity: i.quantity,
        unit_price: i.unit_price,
        thumbnail: i.thumbnail,
      })),
      customer: cart.customer
        ? {
            id: cart.customer.id,
            email: cart.customer.email,
            first_name: cart.customer.first_name,
            last_name: cart.customer.last_name,
          }
        : cart.customer_id
        ? { id: cart.customer_id, email: null, first_name: null, last_name: null }
        : null,
      sales_channel: cart.sales_channel
        ? { id: cart.sales_channel.id, name: cart.sales_channel.name }
        : null,
      region: cart.region ? { id: cart.region.id, name: cart.region.name } : null,
      has_shipping_address: Boolean(cart.shipping_address_id),
      recovery_email_sent_at:
        (cart.metadata as Record<string, any> | null | undefined)?.recovery_email_sent_at ?? null,
    }
  })

  res.status(200).json({
    abandoned_carts: enriched,
    count: (metadata as any)?.count ?? list.length,
    offset: validated.offset,
    limit: validated.limit,
    tier: validated.tier,
    idle_minutes: validated.idle_minutes,
  })
}
