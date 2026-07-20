import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getOrderDetailWorkflow } from "@medusajs/medusa/core-flows"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { validatePartnerOrderOwnership } from "../../helpers"
import { PROTECTED_UNIFICATION_METADATA_KEYS } from "../../../../workflows/inventory_orders/dual-write-unified-order"

// Fields a partner is allowed to PATCH on an order — mirrors admin's
// `AdminUpdateOrder` validator (email, addresses, locale, metadata). Anything
// else in the body (status, customer_id, sales_channel_id, …) is dropped rather
// than passed to `updateOrders`, which would otherwise mutate it verbatim.
const PARTNER_UPDATABLE_ORDER_FIELDS = [
  "email",
  "shipping_address",
  "billing_address",
  "locale",
  "metadata",
] as const

/**
 * GET / POST partner order detail.
 *
 * Field selection is handled by `validateAndTransformQuery` middleware
 * (registered in `apps/backend/src/api/middlewares.ts`) using Medusa's
 * own admin order query config. That middleware:
 *
 *   1. Validates `?fields=...` from the request
 *   2. Merges with the admin defaults (`retrieveTransformQueryConfig.defaults`)
 *   3. Normalises field paths so bare cross-module references
 *      (e.g. `region.automatic_taxes`) get expanded via remote-link
 *      instead of being passed to MikroORM as a bare populate
 *
 * Without the middleware, bare relation paths trip
 * "Cannot read properties of undefined (reading 'kind')" inside
 * MikroORM's `expandDotPaths` because the Order entity has only
 * `region_id` scalars, not ORM relations for cross-module entities.
 *
 * The previous DEFAULT_FIELDS-on-the-route approach bypassed the
 * middleware and broke whenever the partner-ui added a new field — see
 * the order detail crash that motivated this refactor.
 */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerOrderOwnership(req.auth_context, req.params.id, req.scope)

  const { result } = await getOrderDetailWorkflow(req.scope).run({
    input: {
      fields: (req as any).queryConfig.fields,
      order_id: req.params.id,
      version: (req as any).validatedQuery?.version,
    },
  })

  // #342 — make the order self-describe its kind + work-status for the partner
  // UI. The `getOrderDetailWorkflow` field set is the admin order query config,
  // which does not expand our custom order links, so attach them directly here
  // (mirrors `list-partner-orders.ts` discrimination). The order↔execution links
  // are 1:1, so each reverse accessor resolves to a single `{ id }` object; the
  // UI tolerates object-or-array. `unified_order_status.partner_status` is the
  // PR-F sidecar column the work-status badge reads (PR-H made it the SOLE
  // surface — the metadata copy is gone). Best-effort: a graph hiccup must not
  // break the detail route.
  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "orders",
      fields: [
        "id",
        "production_runs.id",
        "inventory_orders.id",
        "unified_order_status.partner_status",
      ],
      filters: { id: req.params.id },
    })
    const links = data?.[0]
    if (links) {
      ;(result as any).production_runs = links.production_runs
      ;(result as any).inventory_orders = links.inventory_orders
      ;(result as any).unified_order_status = links.unified_order_status
    }
  } catch {
    // leave the order as-is; the UI falls back to retail rendering
  }

  // Line-item thumbnails: the order-time snapshot `item.thumbnail` can be null.
  // Medusa copies it at add-to-cart time via
  //   thumbnail: item.thumbnail ?? variant.thumbnail ?? variant.product.thumbnail
  // (see @medusajs/core-flows prepare-line-item-data) — i.e. ONLY from the
  // product's ROOT `thumbnail`, and only if that was already set then. A product
  // that gained its thumbnail (or only ever had `images`, never a root thumbnail)
  // after the order was placed leaves the snapshot null forever. The partner UI
  // reads `item.thumbnail` directly, so backfill it here from the live product —
  // root thumbnail first, then the first product image — keeping the response
  // self-describing instead of pushing the fallback into every client.
  try {
    const items = (result as any)?.items as Array<any> | undefined
    if (Array.isArray(items) && items.length) {
      const productIdOf = (it: any): string | undefined =>
        it?.product_id || it?.variant?.product?.id || it?.variant?.product_id
      const missing = items.filter((it) => !it?.thumbnail && productIdOf(it))
      const productIds = Array.from(
        new Set(missing.map((it) => productIdOf(it)).filter(Boolean))
      ) as string[]
      if (productIds.length) {
        const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
        const { data: products } = await query.graph({
          entity: "product",
          fields: ["id", "thumbnail", "images.url", "images.rank"],
          filters: { id: productIds },
        })
        const thumbById = new Map<string, string | null | undefined>(
          (products ?? []).map((p: any) => {
            const firstImage = (p.images ?? [])
              .slice()
              .sort((a: any, b: any) => (a?.rank ?? 0) - (b?.rank ?? 0))[0]?.url
            return [p.id, p.thumbnail || firstImage]
          })
        )
        for (const it of missing) {
          const pid = productIdOf(it)
          const thumb = pid ? thumbById.get(pid) : undefined
          if (thumb) it.thumbnail = thumb
        }
      }
    }
  } catch {
    // best-effort: leave snapshot thumbnails as-is
  }

  res.json({ order: result })
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerOrderOwnership(req.auth_context, req.params.id, req.scope)

  const body = (req.body ?? {}) as Record<string, unknown>

  // Whitelist: only the admin-equivalent fields survive. A partner cannot move
  // an order's status, owner, or channel through this route.
  const update: Record<string, unknown> = {}
  for (const field of PARTNER_UPDATABLE_ORDER_FIELDS) {
    if (field in body) {
      update[field] = body[field]
    }
  }

  // metadata is REPLACED (not merged) by `updateOrders`. Read-then-merge so a
  // partner PATCH preserves untouched keys, and force-restore the load-bearing
  // unification keys (#342) so they can never be overwritten or dropped — these
  // discriminate the order and drive billing/statements/panels.
  if ("metadata" in update) {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data: orders } = await query.graph({
      entity: "orders",
      fields: ["id", "metadata"],
      filters: { id: req.params.id },
    })
    const existing = (orders?.[0]?.metadata ?? {}) as Record<string, unknown>
    const incoming = (update.metadata ?? {}) as Record<string, unknown>

    const merged: Record<string, unknown> = { ...existing, ...incoming }
    for (const key of PROTECTED_UNIFICATION_METADATA_KEYS) {
      if (key in existing) {
        merged[key] = existing[key]
      } else {
        delete merged[key]
      }
    }
    update.metadata = merged
  }

  const orderService = req.scope.resolve(Modules.ORDER) as any
  const order = await orderService.updateOrders(req.params.id, update)

  res.json({ order })
}
