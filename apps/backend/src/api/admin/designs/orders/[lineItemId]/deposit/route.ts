import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import designLineItemLink from "../../../../../../links/design-line-item-link"
import { resolveCartCheckoutLink } from "../../../../../../lib/carts/resolve-cart-link"
import {
  closeTrackedPayuLink,
  createPayuLinkForCart,
} from "../../../../../../lib/payments/payu-cart-link"
import { deliverDesignOrderEmail } from "../../../../../../workflows/designs/deliver-design-order-email"
import { applyDesignOrderDeposit } from "../../apply-deposit"
import { hasLinkedSaleOrder } from "../../linked-sale-order"

/**
 * POST /admin/designs/orders/:lineItemId/deposit
 *
 * Put a deposit on a design order, so the buyer's checkout collects
 * `deposit_pct` of the total (or a fixed `deposit_amount`) now and the rest is
 * raised later with `POST /admin/orders/:id/balance`. The rules are
 * `decideDeposit`'s; the writes are `applyDesignOrderDeposit`'s, shared with
 * create (#2645).
 *
 * Body: { deposit_pct?: number, deposit_amount?: number,
 *         balance_trigger?: "manual" | "dispatch", replace?: boolean,
 *         notify_buyer?: boolean (default true) }
 *
 * ## notify_buyer (#2645)
 *
 * 🔴 The buyer's first email and PayU link were for the FULL total. Setting a
 * deposit afterwards changed what checkout charges, but the link in their
 * inbox still asked for everything. So by default a fresh PayU link is minted
 * for the deposit (INR only — `createPayuLinkForCart` switches the old one off)
 * and the design-order email is re-sent with the deposit, the balance and when
 * the balance is due. `notify_buyer: false` sends nothing, but the old
 * full-total link is STILL switched off: a link nobody should pay must not stay
 * payable. The checkout link keeps working and charges the deposit.
 */
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)

  try {
    const { lineItemId } = req.params
    const body = (req.body ?? {}) as {
      deposit_pct?: unknown
      deposit_amount?: unknown
      balance_trigger?: unknown
      replace?: unknown
      notify_buyer?: unknown
    }
    if (body.notify_buyer !== undefined && typeof body.notify_buyer !== "boolean") {
      res.status(400).json({
        reason: "bad_notify_buyer",
        message: "notify_buyer must be true or false.",
      })
      return
    }
    const notifyBuyer = body.notify_buyer !== false
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any

    const { data: linkRows } = await query.graph({
      entity: designLineItemLink.entryPoint,
      filters: { line_item_id: lineItemId },
      fields: ["design_id", "line_item_id"],
    })
    if (!linkRows?.length) {
      res.status(404).json({ message: "Design order not found" })
      return
    }

    const applied = await applyDesignOrderDeposit(req.scope, {
      lineItemId,
      designId: linkRows[0].design_id,
      hasLinkedOrder: await hasLinkedSaleOrder(query, linkRows[0].design_id),
      depositPct: body.deposit_pct,
      depositAmount: body.deposit_amount,
      balanceTrigger: body.balance_trigger,
      replace: body.replace === true,
      setBy: (req as any).auth_context?.actor_id ?? null,
    })

    if (!applied.ok) {
      res.status(applied.status).json({ message: applied.message, reason: applied.reason })
      return
    }
    const cartId = applied.deposit.cart_id

    /**
     * Tell the buyer, or at least stop the old link. Both never throw and never
     * fail the response: the schedule is saved, and this response is the
     * operator's only view of whether the buyer was told.
     */
    let buyerNotification: Record<string, unknown>
    if (notifyBuyer) {
      const { link } = await resolveCartCheckoutLink(req.scope, cartId)
      const payu = await createPayuLinkForCart(req.scope, cartId, {
        description: `Design order ${cartId} (deposit)`,
      })
      const email = await deliverDesignOrderEmail(req.scope, {
        cart: { id: cartId },
        checkoutUrl: link.url,
        paymentLink: payu.payment_link,
        paymentLinkExpiresLabel: payu.expires_label ?? null,
        paymentQrKind: payu.qr_kind ?? null,
      })
      buyerNotification = {
        notified: true,
        checkout_url: link.url,
        checkout_url_reason: link.url ? null : link.reason,
        payment_link: payu.payment_link,
        /** Why there is no payment link — non-INR is the ordinary case. */
        payment_link_reason: payu.reason,
        payment_link_expires_at: payu.expires_at ?? null,
        replaced_payment_link_invoice: payu.replaced_invoice_number ?? null,
        email,
      }
    } else {
      const closed = await closeTrackedPayuLink(req.scope, cartId, "deposit_set")
      buyerNotification = {
        notified: false,
        payment_link: null,
        payment_link_reason: "notify_buyer was false, so no new link was minted.",
        closed_payment_link_invoice: closed.closed_invoice_number,
        closed_payment_link_error: closed.error,
        email: null,
      }
    }

    res.status(200).json({
      design_order_deposit: {
        ...applied.deposit,
        ...buyerNotification,
      },
    })
  } catch (e: any) {
    logger?.error?.(
      `[admin] setting a deposit on design order ${req.params.lineItemId} failed: ${e?.message ?? e}`
    )
    res.status(500).json({ message: "Failed to set a deposit on this design order." })
  }
}
