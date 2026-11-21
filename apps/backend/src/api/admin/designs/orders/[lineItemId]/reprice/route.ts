import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import designLineItemLink from "../../../../../../links/design-line-item-link"
import {
  depositBlocksEdit,
  resyncManualDeposit,
} from "../../../../../../lib/payments/resync-manual-deposit"
import { PAYMENT_SCHEDULE_MODULE } from "../../../../../../modules/payment_schedule"
import { refreshDesignCartTax } from "../../../../../../workflows/designs/lib/refresh-design-cart-tax"
import { hasLinkedSaleOrder } from "../../linked-sale-order"
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
            select: ["id", "currency_code", "completed_at", "metadata"],
          })
          .catch(() => null)
      : null

    /**
     * 🔴 `cart.completed_at` is NOT a usable conversion signal here — 2 of 48
     * carts carry it locally. The linked order is, and it is the same thing
     * the detail page uses to decide it is past the cart stage.
     */
    // Sale orders only — a partner's work order on this design is not a purchase.
    const linkedSaleOrder = await hasLinkedSaleOrder(query, linkRows[0].design_id)

    const decision = decideReprice({
      cart,
      currentUnitPrice: lineItem?.unit_price,
      unitPrice: (req.body as { unit_price?: unknown } | undefined)?.unit_price,
      hasLinkedOrder: linkedSaleOrder,
    })

    if (!decision.ok) {
      const status =
        decision.reason === "cart_completed" || decision.reason === "cancelled"
          ? 409
          : decision.reason === "no_cart"
            ? 404
            : 400
      res.status(status).json({ message: decision.message, reason: decision.reason })
      return
    }

    /**
     * A deposit's schedule records the split of the old total. An UNPAID
     * percentage deposit is re-split below (#2566); a paid, quote or fixed one
     * still refuses — see `depositBlocksEdit`.
     */
    const schedules: any = req.scope.resolve(PAYMENT_SCHEDULE_MODULE)
    const schedule = cart ? await schedules.findByCartId(cart.id) : null
    const blocked = depositBlocksEdit(schedule)
    if (blocked) {
      res.status(409).json({ reason: "has_deposit", message: blocked })
      return
    }

    /**
     * With a deposit, the checkout's payment collection is checked against the
     * schedule, so one opened for the old figure would be refused at checkout.
     * Clear it if unpaid (as amend and deposit do); refuse if money is on it.
     */
    let clearedCollectionId: string | null = null
    if (schedule) {
      const { data: rows } = await query.graph({
        entity: "cart",
        fields: ["id", "payment_collection.id", "payment_collection.payments.id"],
        filters: { id: cart!.id },
      })
      const collection = rows?.[0]?.payment_collection
      if (collection?.payments?.length) {
        res.status(409).json({
          reason: "collection_has_payments",
          message:
            "The buyer's checkout already holds a payment against the current total. " +
            "Resolve that payment before repricing.",
        })
        return
      }
      if (collection?.id) {
        const link: any = req.scope.resolve(ContainerRegistrationKeys.LINK)
        await link.dismiss([
          {
            [Modules.CART]: { cart_id: cart!.id },
            [Modules.PAYMENT]: { payment_collection_id: collection.id },
          },
        ])
        await (req.scope.resolve(Modules.PAYMENT) as any).deletePaymentCollections([
          collection.id,
        ])
        clearedCollectionId = collection.id
      }
    }

    await cartService.updateLineItems(
      { id: lineItemId },
      { unit_price: decision.unit_price, is_custom_price: true }
    )
    // A cart minted before tax was computed at mint has no tax lines to carry
    // the new price; recompute so the buyer is charged GST on it.
    const totals = await refreshDesignCartTax(req.scope, cart!.id)
    const resynced = schedule
      ? await resyncManualDeposit(
          schedules,
          schedule,
          Number(totals.total),
          (req as any).auth_context?.actor_id ?? null
        )
      : null

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
        total: totals.total,
        /** Null when the order has no deposit. Re-split on the new total (#2566). */
        deposit: resynced
          ? {
              deposit_pct: Number(resynced.deposit_pct),
              deposit_amount: Number(resynced.deposit_amount),
              balance_amount: Number(resynced.balance_amount),
            }
          : null,
        cleared_payment_collection_id: clearedCollectionId,
      },
    })
  } catch (e: any) {
    logger?.error?.(
      `[admin] repricing design order ${req.params.lineItemId} failed: ${e?.message ?? e}`
    )
    res.status(500).json({ message: "Failed to reprice this design order line." })
  }
}
