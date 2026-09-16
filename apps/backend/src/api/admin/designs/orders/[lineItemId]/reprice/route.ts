import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import designLineItemLink from "../../../../../../links/design-line-item-link"
import designOrderLink from "../../../../../../links/design-order-link"
import { decideReprice } from "../../mutate-design-order"

/**
 * POST /admin/designs/orders/:lineItemId/reprice
 *
 * Set a new price on a design order line that already exists.
 *
 * The price was decided once, when the cart was created from the design's
 * estimate, and nothing could change it afterwards — no admin route could
 * mutate a cart. A price agreed with the buyer after the fact had no way in.
 * #1970 PR5.
 *
 * 🔑 The line is already `is_custom_price: true`, which is what makes this
 * safe: nothing recalculates it, so writing it does not fight Medusa's
 * pricing. It is also why nothing will ever CORRECT a wrong one — the number
 * written here is the number the buyer pays.
 *
 * Body: `{ unit_price: number }`, major units, in the cart's own currency.
 * There is no currency argument on purpose: the cart's region fixes the
 * currency, and a price in a different one would be valued by one number and
 * labelled by another (the #1979 shape).
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
      { select: ["id", "cart_id", "unit_price"] }
    )
    const cart = lineItem?.cart_id
      ? await cartService
          .retrieveCart(lineItem.cart_id, {
            select: ["id", "currency_code", "completed_at"],
          })
          .catch(() => null)
      : null

    /**
     * 🔴 `cart.completed_at` is NOT a usable conversion signal here — 2 of 48
     * carts carry it locally. The linked order is, and it is the same thing
     * the detail page uses to decide it is past the cart stage.
     */
    const { data: orderLinks = [] } = await query
      .graph({
        entity: designOrderLink.entryPoint,
        filters: { design_id: linkRows[0].design_id },
        fields: ["order_id"],
      })
      .catch(() => ({ data: [] }))

    const decision = decideReprice({
      cart,
      currentUnitPrice: lineItem?.unit_price,
      unitPrice: (req.body as { unit_price?: unknown } | undefined)?.unit_price,
      hasLinkedOrder: (orderLinks as any[]).some((l) => l?.order_id),
    })

    if (!decision.ok) {
      const status =
        decision.reason === "cart_completed"
          ? 409
          : decision.reason === "no_cart"
            ? 404
            : 400
      res.status(status).json({ message: decision.message, reason: decision.reason })
      return
    }

    await cartService.updateLineItems(
      { id: lineItemId },
      { unit_price: decision.unit_price, is_custom_price: true }
    )

    logger?.info?.(
      `[admin] design order line ${lineItemId} repriced ${decision.previous} -> ` +
        `${decision.unit_price} ${cart!.currency_code}`
    )

    res.status(200).json({
      design_order_reprice: {
        line_item_id: lineItemId,
        design_id: linkRows[0].design_id,
        cart_id: cart!.id,
        currency_code: cart!.currency_code,
        unit_price: decision.unit_price,
        previous_unit_price: decision.previous,
      },
    })
  } catch (e: any) {
    logger?.error?.(
      `[admin] repricing design order ${req.params.lineItemId} failed: ${e?.message ?? e}`
    )
    res.status(500).json({ message: "Failed to reprice this design order line." })
  }
}
