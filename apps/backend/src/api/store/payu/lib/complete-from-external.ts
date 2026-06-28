/**
 * Complete a cart into an order from an externally-verified payment (a paid
 * PayU payment link). The link is collected out-of-band on PayU's side, so we
 * attach a payment session on the cart and run the standard completeCartWorkflow
 * — the same end state as a normal checkout.
 *
 * Provider resolution (no hard dependency on a manual provider being enabled):
 *  - prefer the region's own PayU provider (`pp_payu_*`). Its authorizePayment
 *    re-verifies the txn via PayU's verify_payment and returns captured, so the
 *    order records a real PayU payment. INR regions only need PayU enabled.
 *  - else fall back to `pp_system_default` (manual) with the external ref.
 *  - `PAYU_LINK_COMPLETE_PROVIDER` overrides the choice.
 *
 * Idempotent: if the cart is already completed (duplicate webhook), it returns
 * the existing order id instead of throwing.
 */
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  completeCartWorkflow,
  createPaymentCollectionForCartWorkflow,
  createPaymentSessionsWorkflow,
} from "@medusajs/medusa/core-flows"

export type CompleteResult = {
  order_id: string | null
  already_completed: boolean
}

/**
 * Pick the provider to authorize the out-of-band payment with, from the
 * region's enabled providers. Prefer PayU (so the order books a real PayU
 * payment), then a manual provider, then whatever is enabled.
 */
export function resolveCompletionProvider(
  regionProviders: Array<{ id: string; is_enabled?: boolean }> | undefined,
  override?: string
): string {
  if (override) return override
  const enabled = (regionProviders ?? [])
    .filter((p) => p?.is_enabled !== false)
    .map((p) => p.id)
  return (
    enabled.find((id) => id.includes("payu")) ??
    (enabled.includes("pp_system_default") ? "pp_system_default" : undefined) ??
    enabled[0] ??
    "pp_system_default"
  )
}

/** Session payload the chosen provider authorizes against. */
export function buildSessionData(
  provider: string,
  ref?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (provider.includes("payu")) {
    // PayU.authorizePayment reads these flat keys, re-verifies txnid, captures.
    return {
      payu_status: "success",
      txnid: ref?.txnid,
      mihpayid: ref?.mihpayid,
      mode: ref?.mode,
      bank_ref_num: ref?.bank_ref_num,
    }
  }
  return ref ? { external_payment: ref } : undefined
}

export async function completeCartFromExternalPayment(
  scope: any,
  cartId: string,
  ref?: Record<string, unknown>
): Promise<CompleteResult> {
  const logger: any = scope.resolve(ContainerRegistrationKeys.LOGGER)
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: carts } = await query.graph({
    entity: "cart",
    fields: [
      "id",
      "completed_at",
      "metadata",
      "region.payment_providers.id",
      "region.payment_providers.is_enabled",
      "payment_collection.id",
      "payment_collection.payment_sessions.id",
      "payment_collection.payment_sessions.provider_id",
    ],
    filters: { id: cartId },
  })
  const cart = carts?.[0] as any
  if (!cart) {
    throw new Error(`Cart ${cartId} not found`)
  }

  // Idempotency: already turned into an order by an earlier (duplicate) event.
  // The order id is read from the cart metadata marker stamped at completion
  // (below) — Medusa's order↔cart relation is a link, not a queryable
  // `order.cart_id` column, so we can't filter orders by cart id directly.
  if (cart.completed_at) {
    return {
      order_id: (cart.metadata as any)?.payu_order_id ?? null,
      already_completed: true,
    }
  }

  const provider = resolveCompletionProvider(
    cart.region?.payment_providers,
    process.env.PAYU_LINK_COMPLETE_PROVIDER
  )

  // Ensure a payment collection.
  let pcId: string | undefined = cart.payment_collection?.id
  if (!pcId) {
    const { result } = await createPaymentCollectionForCartWorkflow(scope).run({
      input: { cart_id: cartId },
    })
    pcId = (result as any).id
  }

  // Ensure a session on the chosen provider to authorize (paid out-of-band).
  const sessions: any[] = cart.payment_collection?.payment_sessions || []
  if (!sessions.some((s) => s.provider_id === provider)) {
    await createPaymentSessionsWorkflow(scope).run({
      input: {
        payment_collection_id: pcId!,
        provider_id: provider,
        data: buildSessionData(provider, ref),
      },
    })
  }

  // Standard completion → order.
  const { result } = await completeCartWorkflow(scope).run({ input: { id: cartId } })
  const orderId = (result as any)?.id ?? null
  logger.info(`[PayU Link] cart ${cartId} completed via ${provider} → order ${orderId}`)

  // Stamp the order id on the cart so a replayed webhook can return it
  // idempotently (see the completed_at branch above). Best-effort.
  if (orderId) {
    try {
      const cartService: any = scope.resolve(Modules.CART)
      await cartService.updateCarts(cartId, {
        metadata: { ...(cart.metadata || {}), payu_order_id: orderId },
      })
    } catch (e: any) {
      logger.warn(
        `[PayU Link] failed to stamp payu_order_id on cart ${cartId}: ${e?.message}`
      )
    }
  }

  return { order_id: orderId, already_completed: false }
}
