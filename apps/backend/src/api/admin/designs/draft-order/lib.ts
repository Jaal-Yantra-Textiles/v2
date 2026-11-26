import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"

import { createDraftOrderFromDesignsWorkflow } from "../../../../workflows/designs/create-draft-order-from-designs"
import designLineItemLink from "../../../../links/design-line-item-link"
import { blockingDesignIds } from "../orders/mutate-design-order"
import {
  applyDesignOrderDeposit,
  type AppliedDeposit,
  type ApplyDepositResult,
} from "../orders/apply-deposit"
import { resolveCartCheckoutLink } from "../../../../lib/carts/resolve-cart-link"
import { createPayuLinkForCart } from "../../../../lib/payments/payu-cart-link"
import { deliverDesignOrderEmail } from "../../../../workflows/designs/deliver-design-order-email"

export type CreateDesignOrderBody = {
  design_ids: string[]
  currency_code?: string
  price_overrides?: Record<string, number>
  /** Currency of price_overrides (e.g. "inr"). Defaults to store default. */
  override_currency?: string
  /** ISO-2 the buyer purchases from. See the validator for why it matters. */
  country_code?: string
  /** #2645 — a deposit at creation: % of the total collected now. */
  deposit_pct?: number
  /** #2645 — OR a fixed deposit, in the cart's currency. */
  deposit_amount?: number
  /** #2645 — when the balance is asked for. Default "manual". */
  balance_trigger?: "manual" | "dispatch"
}

/**
 * Turn selected designs into ONE draft order — with or without a customer.
 *
 * ## Why the customer is optional
 *
 * The designs list offered "Create Order" on any selection and then refused it
 * unless every selected design already carried a customer link. On this
 * platform that is the exception, not the rule: a design only gets a customer
 * when it was made for somebody, and most are made for stock, from a brief, or
 * out of the assistant. The operator was told to "link a customer first" for an
 * order they were creating precisely because there is not one yet.
 *
 * 🔑 A cart with no customer is an ordinary thing here — a draft the buyer is
 * attached to later, at checkout or when the order is claimed. What is NOT
 * ordinary is a cart attached to the WRONG customer, which is what asking the
 * operator to pick one "to get past the dialog" would eventually produce.
 *
 * ⚠️ `email` follows the customer. Left null it is filled in at checkout; the
 * one thing never done here is inventing a placeholder address, which would put
 * an unreachable buyer on a real order.
 */
export const createDesignDraftOrder = async (
  req: MedusaRequest<CreateDesignOrderBody>,
  res: MedusaResponse,
  customer_id: string | null
) => {
  const {
    design_ids,
    currency_code,
    price_overrides,
    override_currency,
    country_code,
    deposit_pct,
    deposit_amount,
    balance_trigger,
  } = req.validatedBody as CreateDesignOrderBody
  const wantsDeposit =
    (deposit_pct !== undefined && deposit_pct !== null) ||
    (deposit_amount !== undefined && deposit_amount !== null)

  /**
   * Prevent a duplicate cart — but only for designs in a LIVE checkout.
   *
   * 🔴 This used to match any `design-line-item` link row and never look at
   * the cart behind it. Nothing in the codebase deletes one of those rows, so
   * a design was locked to the first cart it ever entered FOREVER, and the
   * cancel route could retire a wrong-currency order but never let anyone
   * raise the corrected one. See `blockingDesignIds` for the rule.
   */
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  try {
    const { data: existingLinks = [] } = await query.graph({
      entity: designLineItemLink.entryPoint,
      filters: { design_id: design_ids },
      fields: ["design_id", "line_item_id"],
    })

    if (existingLinks?.length) {
      const cartService = req.scope.resolve(Modules.CART) as any

      const lineItemIds = existingLinks.map((l: any) => l.line_item_id)
      const lineItems = await cartService
        .listLineItems({ id: lineItemIds }, { select: ["id", "cart_id"] })
        .catch(() => [])

      const cartIdByLineItem: Record<string, string> = {}
      for (const li of lineItems ?? []) {
        if (li?.id && li?.cart_id) cartIdByLineItem[li.id] = li.cart_id
      }

      const carts = await cartService
        .listCarts(
          { id: [...new Set(Object.values(cartIdByLineItem))] },
          { select: ["id", "completed_at", "metadata"] }
        )
        .catch(() => [])

      const cartById: Record<string, any> = {}
      for (const c of carts ?? []) {
        if (c?.id) cartById[c.id] = c
      }

      const cartByLineItem: Record<string, any> = {}
      for (const l of existingLinks) {
        const cartId = cartIdByLineItem[l.line_item_id]
        cartByLineItem[l.line_item_id] = cartId ? cartById[cartId] : null
      }

      const alreadyLinkedIds = blockingDesignIds({
        links: existingLinks as Array<{
          design_id: string
          line_item_id: string
        }>,
        cartByLineItem,
      })

      if (alreadyLinkedIds.length) {
        throw new MedusaError(
          MedusaError.Types.DUPLICATE_ERROR,
          `Designs already in checkout: ${alreadyLinkedIds.join(", ")}. Remove them from existing carts first.`
        )
      }
    }
  } catch (e: any) {
    if (e instanceof MedusaError) throw e
    // Link table may not exist yet — safe to proceed
  }

  const { result: cart } = await createDraftOrderFromDesignsWorkflow(
    req.scope
  ).run({
    input: {
      customer_id,
      design_ids,
      currency_code,
      price_overrides,
      override_currency,
      country_code,
    },
  })

  /**
   * #2645 — the deposit goes on BEFORE the link and the email. Both price off
   * the schedule, so a schedule opened afterwards would leave the buyer's first
   * link asking for the full total and the first email quoting it (#176's
   * overcharge, by PayU).
   *
   * 🔴 If the deposit is refused (e.g. a fixed amount not below the real
   * total), NOTHING is sent: no PayU link, no email. The cart exists and is
   * returned with a 4xx naming it, so the operator sets the deposit with
   * `set_design_order_deposit` (which then sends the link and email). Sending
   * the full-total link "because the deposit failed" is the bug itself.
   */
  let deposit: AppliedDeposit | null = null
  if (wantsDeposit) {
    const lineItemId = await firstDesignLineItemId(query, cart.id)
    const applied: ApplyDepositResult = lineItemId
      ? await applyDesignOrderDeposit(req.scope, {
          lineItemId: lineItemId.line_item_id,
          designId: lineItemId.design_id,
          // A cart this request just made has no order behind it. Asking the
          // design's links would refuse a repeat design order as "converted".
          hasLinkedOrder: false,
          depositPct: deposit_pct,
          depositAmount: deposit_amount,
          balanceTrigger: balance_trigger,
          setBy: (req as any).auth_context?.actor_id ?? null,
        })
      : {
          ok: false,
          status: 409,
          reason: "no_cart",
          message: "The new design order has no design line to hang a deposit on.",
        }
    if (!applied.ok) {
      logger?.error?.(
        `[design-order] cart ${cart.id} created but its deposit was refused (${applied.reason}): ${applied.message}. Nothing was sent to the buyer.`
      )
      res.status(applied.status === 404 ? 409 : applied.status).json({
        reason: applied.reason,
        message:
          `The design order (cart ${cart.id}) was created, but the deposit was refused: ${applied.message} ` +
          "No payment link or email was sent. Set the deposit with set_design_order_deposit, which then sends them.",
        cart,
        deposit: null,
        email: null,
        payment_link: null,
      })
      return
    }
    deposit = applied.deposit
  }

  /**
   * 🔴 This was `STORE_URL + "/checkout/cart/" + cart.id` — one hardcoded shop
   * for all 14 tenants, and no country segment, so the storefront middleware
   * re-regioned the cart to `NEXT_PUBLIC_DEFAULT_REGION` (#2051's shape). The
   * resolution now lives in one place, shared with `/r/cart/:id`.
   *
   * A null url is reported, not thrown: the order exists either way, and the
   * operator needs to be told it exists even when we cannot name its shop.
   */
  const { link } = await resolveCartCheckoutLink(req.scope, cart.id)
  if (!link.url) {
    logger?.warn?.(
      `[design-order] no checkout link for cart ${cart.id}: ${link.reason}`
    )
  }

  const payu = await createPayuLinkForCart(req.scope, cart.id, {
    description: `Design order ${cart.id}`,
  })

  /**
   * Never allowed to fail the create: the cart is already committed and this
   * response is the only place the operator is shown the link. A failed send
   * comes back as a verdict the panel renders, not as a 500 that destroys it.
   */
  const email = await deliverDesignOrderEmail(req.scope, {
    cart,
    checkoutUrl: link.url,
    paymentLink: payu.payment_link,
    paymentLinkExpiresLabel: payu.expires_label ?? null,
    paymentQrKind: payu.qr_kind ?? null,
  })

  res.json({
    cart,
    email,
    checkout_url: link.url,
    /** Why there is no checkout link. Null when there is one. */
    checkout_url_reason: link.url ? null : link.reason,
    payment_link: payu.payment_link,
    /** Why there is no payment link — non-INR is the ordinary case. */
    payment_link_reason: payu.reason,
    payment_link_expires_at: payu.expires_at ?? null,
    /** The schedule opened at creation (#2645). Null when no deposit was asked for. */
    deposit,
  })
}

/**
 * The new cart's first design line — the deposit's `source_id`, exactly as the
 * deposit route records it. Read back, because the cart the workflow returns
 * predates its own line items.
 */
const firstDesignLineItemId = async (
  query: any,
  cartId: string
): Promise<{ line_item_id: string; design_id: string } | null> => {
  const { data } = await query.graph({
    entity: "cart",
    fields: ["id", "items.id", "items.metadata"],
    filters: { id: cartId },
  })
  const items: any[] = data?.[0]?.items ?? []
  for (const li of items) {
    const designId = String(li?.metadata?.design_id ?? "").trim()
    if (li?.id && designId) return { line_item_id: li.id, design_id: designId }
  }
  return null
}
