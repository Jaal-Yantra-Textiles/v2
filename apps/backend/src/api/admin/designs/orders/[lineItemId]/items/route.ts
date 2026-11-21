import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import designLineItemLink from "../../../../../../links/design-line-item-link"
import { resolveCartCheckoutLink } from "../../../../../../lib/carts/resolve-cart-link"
import { createPayuLinkForCart } from "../../../../../../lib/payments/payu-cart-link"
import {
  depositBlocksEdit,
  resyncManualDeposit,
} from "../../../../../../lib/payments/resync-manual-deposit"
import { PAYMENT_SCHEDULE_MODULE } from "../../../../../../modules/payment_schedule"
import { amendDesignOrderWorkflow } from "../../../../../../workflows/designs/amend-design-order"
import { deliverDesignOrderEmail } from "../../../../../../workflows/designs/deliver-design-order-email"
import { refreshDesignCartTax } from "../../../../../../workflows/designs/lib/refresh-design-cart-tax"
import { hasLinkedSaleOrder } from "../../linked-sale-order"
import { decideAmend } from "../../mutate-design-order"

type AmendBody = {
  add_design_ids?: unknown
  remove_line_item_ids?: unknown
  price_overrides?: unknown
  override_currency?: unknown
  notify?: unknown
}

/**
 * POST /admin/designs/orders/:lineItemId/items
 *
 * Amend a design order the buyer has not paid yet: add designs as new lines
 * and/or take lines off. `:lineItemId` is ANY line of the order — it only
 * identifies the cart.
 *
 * Body:
 * - `add_design_ids`        designs to add, one line each
 * - `price_overrides`       `{ design_id: price }` for added designs; without
 *                           one, the design's estimate is used (and a design
 *                           with no estimate is refused, never priced at 0)
 * - `override_currency`     currency of the overrides — defaults to the
 *                           CART's currency, unlike create (which defaults to
 *                           the house store's), because the order already has one
 * - `remove_line_item_ids`  cart lines to take off (soft-deleted)
 * - `notify`                true → email the buyer the updated order with a
 *                           fresh checkout link and PayU link
 *
 * The rules — what is refused and why — live in `decideAmend`.
 *
 * ## 🔴 The old PayU link
 *
 * A PayU payment link is minted with a FIXED amount. After an amend the link in
 * the buyer's original email still asks for the old total, and the PayU webhook
 * completes a cart only when the amount covers the cart total — so a buyer who
 * pays that old link after lines were ADDED pays and gets no order. A fresh link
 * is minted on every amend and returned; send it (`notify: true`) whenever the
 * buyer already has the old one.
 */
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const { lineItemId } = req.params
  const body = (req.body ?? {}) as AmendBody

  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any
    const cartService = req.scope.resolve(Modules.CART) as any
    const schedules: any = req.scope.resolve(PAYMENT_SCHEDULE_MODULE)

    const { data: anchorLinks } = await query.graph({
      entity: designLineItemLink.entryPoint,
      filters: { line_item_id: lineItemId },
      fields: ["design_id", "line_item_id"],
    })
    if (!anchorLinks?.length) {
      res.status(404).json({ message: "Design order not found" })
      return
    }

    const [lineItem] = await cartService.listLineItems(
      { id: lineItemId },
      { select: ["id", "cart_id"] }
    )
    const cart = lineItem?.cart_id
      ? (
          await query.graph({
            entity: "cart",
            fields: [
              "id",
              "email",
              "currency_code",
              "completed_at",
              "metadata",
              "items.id",
              "items.metadata",
              "payment_collection.id",
              "payment_collection.payments.id",
            ],
            filters: { id: lineItem.cart_id },
          })
        ).data?.[0] ?? null
      : null

    const itemIds: string[] = (cart?.items ?? []).map((i: any) => i.id)
    const { data: lineLinks = [] } = itemIds.length
      ? await query.graph({
          entity: designLineItemLink.entryPoint,
          filters: { line_item_id: itemIds },
          fields: ["design_id", "line_item_id"],
        })
      : { data: [] }
    const designByLine: Record<string, string> = {}
    for (const l of lineLinks as any[]) designByLine[l.line_item_id] = l.design_id
    const currentLines = (cart?.items ?? []).map((i: any) => ({
      line_item_id: i.id,
      design_id: designByLine[i.id] ?? i.metadata?.design_id ?? null,
    }))

    const schedule = cart ? await schedules.findByCartId(cart.id) : null
    const decision = decideAmend({
      cart,
      hasLinkedOrder: await hasLinkedSaleOrder(query, anchorLinks[0].design_id),
      depositBlock: depositBlocksEdit(schedule),
      collectionHasPayments: Boolean(cart?.payment_collection?.payments?.length),
      currentLines,
      addDesignIds: body.add_design_ids,
      removeLineItemIds: body.remove_line_item_ids,
      priceOverrides: body.price_overrides,
    })

    if (!decision.ok) {
      const status =
        decision.reason === "no_cart"
          ? 404
          : decision.reason === "cart_completed" ||
              decision.reason === "cancelled" ||
              decision.reason === "has_deposit" ||
              decision.reason === "collection_has_payments"
            ? 409
            : 400
      res.status(status).json({ message: decision.message, reason: decision.reason })
      return
    }

    const overrides =
      body.price_overrides && typeof body.price_overrides === "object"
        ? (body.price_overrides as Record<string, number>)
        : undefined
    const overrideCurrency =
      typeof body.override_currency === "string" && body.override_currency.trim()
        ? body.override_currency.trim().toLowerCase()
        : String(cart.currency_code).toLowerCase()

    let added: any[] = []
    try {
      const { result } = await amendDesignOrderWorkflow(req.scope).run({
        input: {
          cart_id: cart.id,
          currency_code: cart.currency_code,
          add_design_ids: decision.add_design_ids,
          remove_line_item_ids: decision.remove_line_item_ids,
          price_overrides: overrides,
          override_currency: overrideCurrency,
        },
      })
      added = result.added ?? []
    } catch (e: any) {
      // The estimator refuses a design it cannot price — that is the caller's
      // to fix (pass a price), not a server fault.
      if (/Cannot price design|Design not found/i.test(e?.message ?? "")) {
        res.status(400).json({ reason: "cannot_price", message: e.message })
        return
      }
      throw e
    }

    /**
     * A collection opened at checkout carries the OLD total. It holds no
     * payment (decideAmend refused that), so drop it and let checkout open a
     * new one for the amended total — the same move the deposit route makes.
     */
    let clearedCollectionId: string | null = null
    const collection = cart.payment_collection
    if (collection?.id) {
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

    const totals = await refreshDesignCartTax(req.scope, cart.id)

    /**
     * #2566 — an unpaid percentage deposit follows the new total, so the
     * checkout and the PayU link below ask for 70% of the RIGHT number.
     * Re-split before minting the link: the link prices off the schedule.
     */
    const resynced = schedule
      ? await resyncManualDeposit(
          schedules,
          schedule,
          Number(totals.total),
          (req as any).auth_context?.actor_id ?? null
        )
      : null

    const { link } = await resolveCartCheckoutLink(req.scope, cart.id)
    const payu = await createPayuLinkForCart(req.scope, cart.id, {
      description: `Design order ${cart.id}`,
    })

    const email =
      body.notify === true
        ? await deliverDesignOrderEmail(req.scope, {
            cart,
            checkoutUrl: link.url,
            paymentLink: payu.payment_link,
            paymentLinkExpiresLabel: payu.expires_label ?? null,
          })
        : null

    const { data: after } = await query.graph({
      entity: "cart",
      fields: ["id", "items.id", "items.title", "items.unit_price", "items.metadata"],
      filters: { id: cart.id },
    })

    logger?.info?.(
      `[design-order] amended cart ${cart.id}: +${decision.add_design_ids.length} ` +
        `-${decision.remove_line_item_ids.length} lines, total now ${totals.total} ` +
        `${String(cart.currency_code).toUpperCase()}` +
        (clearedCollectionId ? `; cleared unpaid collection ${clearedCollectionId}` : "")
    )

    res.status(200).json({
      design_order_amend: {
        cart_id: cart.id,
        currency_code: cart.currency_code,
        added_line_item_ids: added.map((li: any) => li.id),
        removed_line_item_ids: decision.remove_line_item_ids,
        items: (after?.[0]?.items ?? []).map((i: any) => ({
          line_item_id: i.id,
          title: i.title,
          unit_price: Number(i.unit_price),
          design_id: i.metadata?.design_id ?? null,
        })),
        tax_total: totals.tax_total,
        total: totals.total,
        /** Null when the order has no deposit. */
        deposit: resynced
          ? {
              deposit_pct: Number(resynced.deposit_pct),
              deposit_amount: Number(resynced.deposit_amount),
              balance_amount: Number(resynced.balance_amount),
            }
          : null,
        cleared_payment_collection_id: clearedCollectionId,
        checkout_url: link.url,
        checkout_url_reason: link.url ? null : link.reason,
        payment_link: payu.payment_link,
        payment_link_reason: payu.reason,
        payment_link_expires_at: payu.expires_at ?? null,
        replaced_payment_link_invoice: payu.replaced_invoice_number ?? null,
        /** Null when `notify` was not set — nothing was sent. */
        email,
      },
    })
  } catch (e: any) {
    logger?.error?.(
      `[admin] amending design order ${lineItemId} failed: ${e?.message ?? e}`
    )
    res.status(500).json({ message: "Failed to amend this design order." })
  }
}
