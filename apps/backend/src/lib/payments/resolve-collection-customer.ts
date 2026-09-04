import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * The customer a payment collection is being paid by, resolved from its cart.
 *
 * ## Why this exists rather than reading the request
 *
 * `createPaymentSessionsWorkflow` only creates a Stripe account holder — i.e. a
 * real Stripe Customer — `when("customer-id-exists")`, which is to say when a
 * `customer_id` reaches its input. Both of our session call sites used to fail
 * that test:
 *
 *   • the store payment-sessions route passed
 *     `req.auth_context?.actor_id`, which is **undefined for a guest**, and
 *   • `stripe/lib/init-session.ts` passed no `customer_id` at all.
 *
 * 🔴 A B2B quote buyer is DELIBERATELY a guest — the whole premise is that a
 * procurement contact should not have to create an account before acting on a
 * price. So the one population whose card we most want to keep was precisely
 * the one that never got a Stripe Customer.
 *
 * The cart already knows. `acceptQuoteWorkflow` binds it to the quote's own
 * customer server-side, so the answer is on the row rather than in the session.
 *
 * ## The failure this prevents is invisible until the money is due
 *
 * Stripe accepts `setup_future_usage` with no customer, reports it back on the
 * PaymentIntent, and confirms the card happily — `requires_capture`, exactly as
 * a healthy deposit looks. The card is simply never attached to anyone. The
 * refusal arrives weeks later, at the balance charge:
 *
 *     The provided PaymentMethod cannot be attached. To reuse a PaymentMethod,
 *     you must attach it to a Customer first.
 *
 * Nothing earlier in the flow says so. Verified end to end against Stripe test
 * mode: with a customer the same rail charged the balance off-session and
 * returned `succeeded`; without one it failed at exactly that sentence.
 *
 * 🔑 `has_account` is irrelevant — core creates the account holder for a guest
 * customer record too. Only the presence of `customer_id` matters.
 */
export const resolveCollectionCustomerId = async (
  scope: any,
  collectionId: string
): Promise<string | undefined> => {
  /**
   * A missing id would be `filters: { payment_collection_id: undefined }`,
   * which is NOT "no rows" — it is *no filter*, and would hand back the first
   * cart in the table. Refuse before asking.
   */
  if (!collectionId) return undefined

  const query = scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: links } = await query
    .graph({
      entity: "cart_payment_collection",
      filters: { payment_collection_id: collectionId },
      fields: ["cart_id"],
    })
    .catch(() => ({ data: [] }))

  const cartId = links?.[0]?.cart_id
  if (!cartId) return undefined

  return resolveCartCustomerId(scope, cartId)
}

/** The same answer when the cart is already in hand. */
export const resolveCartCustomerId = async (
  scope: any,
  cartId: string
): Promise<string | undefined> => {
  if (!cartId) return undefined

  const query = scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: carts } = await query
    .graph({
      entity: "cart",
      filters: { id: cartId },
      fields: ["customer_id"],
    })
    .catch(() => ({ data: [] }))

  return carts?.[0]?.customer_id ?? undefined
}
