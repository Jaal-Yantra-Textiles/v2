/**
 * Complete a cart into an order from an externally-verified payment (a paid
 * PayU payment link). The link is collected out-of-band on PayU's side, so we
 * model the Medusa payment with the manual/system provider and then run the
 * standard completeCartWorkflow — the same end state as a normal checkout.
 *
 * Idempotent: if the cart is already completed (duplicate webhook), it returns
 * the existing order id instead of throwing.
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  completeCartWorkflow,
  createPaymentCollectionForCartWorkflow,
  createPaymentSessionsWorkflow,
} from "@medusajs/medusa/core-flows"

export type CompleteResult = {
  order_id: string | null
  already_completed: boolean
}

export async function completeCartFromExternalPayment(
  scope: any,
  cartId: string,
  ref?: Record<string, unknown>
): Promise<CompleteResult> {
  const logger: any = scope.resolve(ContainerRegistrationKeys.LOGGER)
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const provider = process.env.PAYU_LINK_COMPLETE_PROVIDER || "pp_system_default"

  const { data: carts } = await query.graph({
    entity: "cart",
    fields: [
      "id",
      "completed_at",
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
  if (cart.completed_at) {
    const { data: orders } = await query.graph({
      entity: "order",
      fields: ["id"],
      filters: { cart_id: cartId } as any,
    })
    return { order_id: orders?.[0]?.id ?? null, already_completed: true }
  }

  // Ensure a payment collection.
  let pcId: string | undefined = cart.payment_collection?.id
  if (!pcId) {
    const { result } = await createPaymentCollectionForCartWorkflow(scope).run({
      input: { cart_id: cartId },
    })
    pcId = (result as any).id
  }

  // Ensure a manual/system session to authorize (the link was paid out-of-band).
  const sessions: any[] = cart.payment_collection?.payment_sessions || []
  if (!sessions.some((s) => s.provider_id === provider)) {
    await createPaymentSessionsWorkflow(scope).run({
      input: {
        payment_collection_id: pcId!,
        provider_id: provider,
        data: ref ? { external_payment: ref } : undefined,
      },
    })
  }

  // Standard completion → order.
  const { result } = await completeCartWorkflow(scope).run({ input: { id: cartId } })
  logger.info(`[PayU Link] cart ${cartId} completed → order ${(result as any)?.id}`)
  return { order_id: (result as any)?.id ?? null, already_completed: false }
}
