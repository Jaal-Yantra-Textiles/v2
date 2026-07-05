import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { buildUcpContext } from "../../../lib/context"
import { formatUcpCheckoutSession, UCP_VERSION } from "../../../lib/formatter"
import { formatUcpError } from "../../../lib/error-formatter"
import { paymentNextAction, pickSession } from "../../../lib/payment-next-action"
import { CHECKOUT_SESSION_CART_FIELDS } from "../../../lib/cart-fields"
import { callStoreRoute } from "../../../../mcp/lib/proxy"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * POST /ucp/checkout-sessions/:id/complete
 *
 * Complete a checkout session. Initializes a payment session with the
 * appropriate provider (PayU for INR, Stripe for non-INR) and returns
 * the next action the agent must take.
 *
 * Unlike the reference implementation (which settles payment synchronously
 * via x402/EIP-3009), our payment flow is async:
 *   - PayU: redirect form → shopper pays on PayU's hosted page → webhook completes cart
 *   - Stripe: hosted card page or client_secret → webhook completes cart
 *
 * So this endpoint returns status "complete_in_progress" with a next_action
 * describing what the agent/shopper must do. The agent polls
 * GET /ucp/checkout-sessions/:id until status = "completed".
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  const ctx = await buildUcpContext(req)
  const body = req.validatedBody as any

  try {
    // Fetch the cart to check readiness
    const query = ctx.container.resolve(ContainerRegistrationKeys.QUERY)
    const { data: [cart] } = await query.graph({
      entity: "cart",
      fields: CHECKOUT_SESSION_CART_FIELDS,
      filters: { id },
    })

    if (!cart) {
      res.status(404).json(formatUcpError({
        ucpVersion: UCP_VERSION,
        code: "not_found",
        content: "Checkout session not found",
      }))
      return
    }

    // Validate prerequisites
    if (!cart.items || cart.items.length === 0) {
      res.status(400).json(formatUcpError({
        ucpVersion: UCP_VERSION,
        code: "missing_items",
        content: "Cannot complete checkout: no line items.",
        severity: "recoverable",
        path: "$.line_items",
      }))
      return
    }
    if (!cart.email) {
      res.status(400).json(formatUcpError({
        ucpVersion: UCP_VERSION,
        code: "missing_email",
        content: "Cannot complete checkout: buyer email is required.",
        severity: "recoverable",
        path: "$.buyer.email",
      }))
      return
    }
    if (!cart.shipping_address) {
      res.status(400).json(formatUcpError({
        ucpVersion: UCP_VERSION,
        code: "missing_shipping_address",
        content: "Cannot complete checkout: shipping address is required.",
        severity: "recoverable",
        path: "$.shipping_address",
      }))
      return
    }

    // Determine the payment provider from the cart's region currency
    const currencyCode = (cart.currency_code || "usd").toLowerCase()
    const isINR = currencyCode === "inr"
    const providerId = isINR ? "pp_payu_payu" : "pp_stripe_stripe"

    // List payment providers to find the right one
    let actualProviderId = providerId
    try {
      const providersResp = await callStoreRoute({
        baseUrl: ctx.baseUrl,
        method: "GET",
        path: "/store/payment-providers",
        query: { region_id: cart.region_id },
        publishableKey: ctx.publishableKey,
      }) as any
      const providers = providersResp?.payment_providers || providersResp || []
      const found = providers.find((p: any) => p.id?.includes(isINR ? "payu" : "stripe"))
      if (found) actualProviderId = found.id
    } catch {
      // Fall back to the default provider id
    }

    // Create payment collection for the cart
    let paymentCollectionId: string | null = null
    try {
      const pcResp = await callStoreRoute({
        baseUrl: ctx.baseUrl,
        method: "POST",
        path: "/store/payment-collections",
        body: { cart_id: id },
        publishableKey: ctx.publishableKey,
      }) as any
      paymentCollectionId = pcResp?.payment_collection?.id || pcResp?.id
    } catch {
      // Payment collection might already exist
    }

    // If no collection was created, try to find existing one
    if (!paymentCollectionId && cart.payment_collection?.id) {
      paymentCollectionId = cart.payment_collection.id
    }

    if (!paymentCollectionId) {
      res.status(500).json(formatUcpError({
        ucpVersion: UCP_VERSION,
        code: "payment_setup_failed",
        content: "Failed to create or find payment collection for the cart.",
      }))
      return
    }

    // Initialize the payment session
    let sessionData: any = null
    try {
      const sessionResp = await callStoreRoute({
        baseUrl: ctx.baseUrl,
        method: "POST",
        path: `/store/payment-collections/${paymentCollectionId}/payment-sessions`,
        body: { provider_id: actualProviderId },
        publishableKey: ctx.publishableKey,
      }) as any
      sessionData = sessionResp
    } catch (e: any) {
      res.status(500).json(formatUcpError({
        ucpVersion: UCP_VERSION,
        code: "payment_session_failed",
        content: `Failed to initialize payment session: ${e.message}`,
      }))
      return
    }

    // Determine the next action
    const session = pickSession(sessionData, actualProviderId)
    const nextAction = paymentNextAction(session)

    // For Stripe, create a hosted payment page if possible
    if (!isINR && nextAction.type === "client_secret") {
      try {
        const pageResp = await callStoreRoute({
          baseUrl: ctx.baseUrl,
          method: "POST",
          path: "/store/stripe/payment-page",
          body: { cart_id: id },
          publishableKey: ctx.publishableKey,
        }) as any
        if (pageResp?.url) {
          nextAction.type = "redirect"
          nextAction.url = pageResp.url
          nextAction.description = "Stripe hosted card page. The shopper pays here; the cart completes via webhook."
        }
      } catch {
        // Fall back to client_secret flow
      }
    }

    // For PayU, create a payment link if possible
    if (isINR) {
      try {
        const linkResp = await callStoreRoute({
          baseUrl: ctx.baseUrl,
          method: "POST",
          path: "/store/payu/payment-link",
          body: { cart_id: id },
          publishableKey: ctx.publishableKey,
        }) as any
        if (linkResp?.payment_link?.payment_url) {
          nextAction.type = "redirect"
          nextAction.url = linkResp.payment_link.payment_url
          nextAction.description = "PayU hosted payment page (cards, UPI, netbanking). The cart completes via webhook."
        }
      } catch {
        // Fall back to redirect_form from session data
      }
    }

    // Re-fetch cart for response
    const { data: [updatedCart] } = await query.graph({
      entity: "cart",
      fields: CHECKOUT_SESSION_CART_FIELDS,
      filters: { id },
    })

    ;(updatedCart as any)._container = ctx.container
    const session2 = await formatUcpCheckoutSession(
      { storeName: ctx.storeName, storefrontUrl: ctx.storefrontUrl, baseUrl: ctx.baseUrl },
      updatedCart
    )

    // Override status to show payment is in progress
    ;(session2 as any).status = "complete_in_progress"
    ;(session2 as any).payment = {
      handler_id: isINR ? "payu" : "stripe",
      provider_id: actualProviderId,
      next_action: nextAction,
      description: "Payment session initialized. The shopper must complete payment at the provided URL. Poll GET /ucp/checkout-sessions/:id until status = 'completed'.",
    }

    res.json(session2)
  } catch (error: any) {
    res.status(500).json(formatUcpError({
      ucpVersion: UCP_VERSION,
      code: "checkout_failed",
      content: error.message,
    }))
  }
}
