import { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import { validatePartnerOrderOwnership } from "../helpers"

/**
 * A partner may act on a payment collection only through an order it owns.
 *
 * 🔴 These routes used to check only that the caller WAS a partner — any
 * partner could mark any collection paid, or delete it, by id (2026-10-14).
 * The collection's order is read from Medusa's own order↔payment-collection
 * link (entity `order_payment_collection`), never taken from the body, and
 * then put through the same ownership rule every partner order route uses.
 *
 * A collection with no order link is refused: there is nothing that says
 * whose it is. Not-found and not-yours read the same, so the route does not
 * confirm that someone else's id exists.
 */
export const assertPartnerOwnsPaymentCollection = async (
  authContext: { actor_id?: string | null } | undefined,
  paymentCollectionId: string,
  container: MedusaContainer
): Promise<{ order_id: string; status: string | null }> => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: links } = await query.graph({
    entity: "order_payment_collection",
    fields: ["order_id", "payment_collection_id"],
    filters: { payment_collection_id: paymentCollectionId },
  })
  const orderId = (links?.[0] as any)?.order_id as string | undefined
  if (!orderId) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Payment collection ${paymentCollectionId} not found`
    )
  }

  try {
    await validatePartnerOrderOwnership(authContext, orderId, container)
  } catch (e: any) {
    if (e?.type === MedusaError.Types.NOT_FOUND || e?.type === MedusaError.Types.NOT_ALLOWED) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Payment collection ${paymentCollectionId} not found`
      )
    }
    throw e
  }

  const { data: collections } = await query.graph({
    entity: "payment_collection",
    fields: ["id", "status"],
    filters: { id: paymentCollectionId },
  })

  return {
    order_id: orderId,
    status: ((collections?.[0] as any)?.status as string) ?? null,
  }
}
