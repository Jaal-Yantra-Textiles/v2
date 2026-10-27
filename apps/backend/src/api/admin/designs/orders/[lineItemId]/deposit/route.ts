import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import designLineItemLink from "../../../../../../links/design-line-item-link"
import { PAYMENT_SCHEDULE_MODULE } from "../../../../../../modules/payment_schedule"
import { hasLinkedSaleOrder } from "../../linked-sale-order"
import { decideDeposit } from "../../mutate-design-order"

/**
 * POST /admin/designs/orders/:lineItemId/deposit
 *
 * Put a deposit on a design order, so the buyer's existing checkout link
 * collects `deposit_pct` of the total now and the rest is raised later with
 * `POST /admin/orders/:id/balance`. The rules are `decideDeposit`'s.
 *
 * Body: { deposit_pct: number, balance_trigger?: "manual" | "dispatch" }
 *
 * 🔴 A stale payment collection. If the buyer already opened checkout, the
 * cart holds a collection for the FULL total, and `ensureCartPaymentCollection`
 * refuses a deposit cart whose collection disagrees with its schedule. So an
 * unpaid collection is cleared here and checkout makes the right one next time.
 * A collection with any payment on it is refused instead: money was taken
 * against the full figure, and that needs a human, not a quiet delete.
 */
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)

  try {
    const { lineItemId } = req.params
    const body = (req.body ?? {}) as { deposit_pct?: unknown; balance_trigger?: unknown }
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any
    const cartService = req.scope.resolve(Modules.CART) as any
    const schedules: any = req.scope.resolve(PAYMENT_SCHEDULE_MODULE)

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
    // query.graph, not retrieveCart: only the graph computes `total`.
    const cart = lineItem?.cart_id
      ? (
          await query.graph({
            entity: "cart",
            fields: [
              "id",
              "currency_code",
              "total",
              "completed_at",
              "metadata",
              "payment_collection.id",
              "payment_collection.amount",
              "payment_collection.payments.id",
            ],
            filters: { id: lineItem.cart_id },
          })
        ).data?.[0] ?? null
      : null

    const existing = cart ? await schedules.findByCartId(cart.id) : null
    const decision = decideDeposit({
      cart,
      depositPct: body.deposit_pct,
      balanceTrigger: body.balance_trigger,
      hasLinkedOrder: await hasLinkedSaleOrder(query, linkRows[0].design_id),
      hasSchedule: Boolean(existing),
    })

    if (!decision.ok) {
      const status =
        decision.reason === "no_cart"
          ? 404
          : decision.reason === "not_a_pct" ||
              decision.reason === "bad_balance_trigger" ||
              decision.reason === "no_total"
            ? 400
            : 409
      res.status(status).json({ message: decision.message, reason: decision.reason })
      return
    }

    const collection = cart.payment_collection
    let clearedCollectionId: string | null = null
    if (collection?.id) {
      if ((collection.payments ?? []).length) {
        res.status(409).json({
          reason: "collection_has_payments",
          message:
            `The buyer's checkout already holds a payment against payment collection ${collection.id}. ` +
            "Resolve that payment before putting a deposit on this order.",
        })
        return
      }
      const link: any = req.scope.resolve(ContainerRegistrationKeys.LINK)
      await link.dismiss([
        {
          [Modules.CART]: { cart_id: cart.id },
          [Modules.PAYMENT]: { payment_collection_id: collection.id },
        },
      ])
      await (req.scope.resolve(Modules.PAYMENT) as any).deletePaymentCollections([
        collection.id,
      ])
      clearedCollectionId = collection.id
    }

    const schedule = await schedules.openForCart({
      cart_id: cart.id,
      currency_code: cart.currency_code,
      total_due: decision.total_due,
      source_type: "manual",
      source_id: lineItemId,
      // Same rail rule as accept-quote: PayU is INR-only.
      rail: String(cart.currency_code).toLowerCase() === "inr" ? "payu" : "stripe",
      quote_deposit_pct: decision.deposit_pct,
      balance_trigger: decision.balance_trigger,
      metadata: {
        design_id: linkRows[0].design_id,
        set_by: (req as any).auth_context?.actor_id ?? null,
      },
    })

    logger?.info?.(
      `[deposit] design order ${lineItemId} (cart ${cart.id}): ${schedule.deposit_pct}% = ` +
        `${schedule.deposit_amount} of ${decision.total_due} ${String(cart.currency_code).toUpperCase()}` +
        (clearedCollectionId ? `; cleared unpaid collection ${clearedCollectionId}` : "")
    )

    res.status(200).json({
      design_order_deposit: {
        line_item_id: lineItemId,
        cart_id: cart.id,
        schedule_id: schedule.id,
        currency_code: cart.currency_code,
        total_due: decision.total_due,
        deposit_pct: Number(schedule.deposit_pct),
        deposit_amount: Number(schedule.deposit_amount),
        balance_amount: Number(schedule.balance_amount),
        balance_trigger: schedule.balance_trigger,
        cleared_payment_collection_id: clearedCollectionId,
      },
    })
  } catch (e: any) {
    logger?.error?.(
      `[admin] setting a deposit on design order ${req.params.lineItemId} failed: ${e?.message ?? e}`
    )
    res.status(500).json({ message: "Failed to set a deposit on this design order." })
  }
}
