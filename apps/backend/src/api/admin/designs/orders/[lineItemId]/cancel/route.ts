import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import designLineItemLink from "../../../../../../links/design-line-item-link"
import designOrderLink from "../../../../../../links/design-order-link"
import { decideCancel } from "../../mutate-design-order"

/**
 * POST /admin/designs/orders/:lineItemId/cancel
 *
 * Retire a design order that should never be paid.
 *
 * Until this existed there was no way to cancel OR delete one: the detail route
 * is GET only, so a design order created with the wrong currency, buyer or
 * designs could only be abandoned — left in the list forever, indistinguishable
 * from one a customer simply has not paid yet.
 *
 * 🔑 SOFT. A design order that was sent to somebody is a thing that happened,
 * and its price and links are the evidence of what was offered. The checkout
 * link stops working; the record stays. Nothing is deleted.
 *
 * Body: `{ reason: string }` — required. See `decideCancel` for why.
 */
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)

  try {
    const { lineItemId } = req.params
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any
    const cartService = req.scope.resolve(Modules.CART) as any

    const { data: linkRows } = await query.graph({
      entity: designLineItemLink.entryPoint,
      filters: { line_item_id: lineItemId },
      fields: ["design_id", "line_item_id"],
    })
    if (!linkRows?.length) {
      res.status(404).json({ message: "Design order not found" })
      return
    }

    const [lineItem] = await cartService.listLineItems(
      { id: lineItemId },
      { select: ["id", "cart_id"] }
    )
    const cart = lineItem?.cart_id
      ? await cartService
          .retrieveCart(lineItem.cart_id, {
            select: ["id", "currency_code", "completed_at", "metadata"],
          })
          .catch(() => null)
      : null

    /**
     * 🔴 The LINKED ORDER is the conversion signal, not `cart.completed_at` —
     * 2 of 48 carts carry that locally, so a guard keyed on it is a guard that
     * does not fire. Same read the reprice route and the detail page use.
     */
    const { data: orderLinks = [] } = await query
      .graph({
        entity: designOrderLink.entryPoint,
        filters: { design_id: linkRows[0].design_id },
        fields: ["order_id"],
      })
      .catch(() => ({ data: [] }))

    const decision = decideCancel({
      cart,
      reason: (req.body as { reason?: unknown } | undefined)?.reason,
      hasLinkedOrder: (orderLinks as any[]).some((l) => l?.order_id),
    })

    if (!decision.ok) {
      const status =
        decision.reason === "cart_completed" || decision.reason === "already_cancelled"
          ? 409
          : decision.reason === "no_cart"
            ? 404
            : 400
      res.status(status).json({ message: decision.message, reason: decision.reason })
      return
    }

    /**
     * Merged into existing metadata, never replacing it. The cart carries
     * `source` and `created_by` from the design-order create, and a wholesale
     * write would drop them — the shape that keeps costing this codebase rows.
     */
    await cartService.updateCarts(cart!.id, {
      metadata: {
        ...(cart!.metadata ?? {}),
        cancelled_at: decision.cancelled_at,
        cancelled_reason: decision.cancelled_reason,
        cancelled_by: (req as any).auth_context?.actor_id ?? null,
      },
    })

    logger?.info?.(
      `[admin] design order line ${lineItemId} (cart ${cart!.id}) cancelled: ${decision.cancelled_reason}`
    )

    res.status(200).json({
      design_order_cancel: {
        line_item_id: lineItemId,
        design_id: linkRows[0].design_id,
        cart_id: cart!.id,
        cancelled_at: decision.cancelled_at,
        cancelled_reason: decision.cancelled_reason,
      },
    })
  } catch (e: any) {
    logger?.error?.(
      `[admin] cancelling design order ${req.params.lineItemId} failed: ${e?.message ?? e}`
    )
    res.status(500).json({ message: "Failed to cancel this design order." })
  }
}
