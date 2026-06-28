/**
 * Ensure a cart has an initialized Stripe payment session, so we can hand the
 * shopper a hosted payment page (`/stripe/pay/:cart_id`) that confirms the
 * cart's OWN PaymentIntent. Unlike PayU, completion is automatic: once the
 * PaymentIntent succeeds, core's payment webhook completes the cart → order.
 *
 * The provider resolution + session lookup are kept pure for unit tests; the
 * orchestrator does the workflow I/O.
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  createPaymentCollectionForCartWorkflow,
  createPaymentSessionsWorkflow,
} from "@medusajs/medusa/core-flows"

/** The Stripe provider enabled on the cart's region, or null. */
export function resolveStripeProvider(
  regionProviders: Array<{ id: string; is_enabled?: boolean }> | undefined,
  override?: string
): string | null {
  if (override) return override
  const enabled = (regionProviders ?? [])
    .filter((p) => p?.is_enabled !== false)
    .map((p) => p.id)
  return enabled.find((id) => id.includes("stripe")) ?? null
}

/** Find the Stripe session on a payment collection's session list, if present. */
export function findStripeSession(sessions: any[] | undefined): any | null {
  return (
    (sessions ?? []).find((s) =>
      String(s?.provider_id || "").includes("stripe")
    ) || null
  )
}

export type EnsureStripeSessionResult =
  | { ok: true; provider_id: string; payment_session_id: string; client_secret: string | null; amount: unknown; currency_code: unknown }
  | { ok: false; status: number; error: string }

/**
 * Ensure the cart has a Stripe payment session (creating the collection +
 * session if needed), then return the session essentials. Returns a typed
 * failure (rather than throwing) for the no-cart / not-INR-region / no-Stripe
 * cases so the route can map them to clean HTTP responses.
 */
export async function ensureStripeSession(
  scope: any,
  cartId: string
): Promise<EnsureStripeSessionResult> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)

  const readCart = async () => {
    const { data } = await query.graph({
      entity: "cart",
      fields: [
        "id",
        "completed_at",
        "currency_code",
        "total",
        "region.payment_providers.id",
        "region.payment_providers.is_enabled",
        "payment_collection.id",
        "payment_collection.payment_sessions.id",
        "payment_collection.payment_sessions.provider_id",
        "payment_collection.payment_sessions.amount",
        "payment_collection.payment_sessions.currency_code",
        "payment_collection.payment_sessions.data",
      ],
      filters: { id: cartId },
    })
    return data?.[0] as any
  }

  let cart = await readCart()
  if (!cart) {
    return { ok: false, status: 404, error: "Cart not found" }
  }
  if (cart.completed_at) {
    return { ok: false, status: 409, error: "Cart is already completed" }
  }

  const provider = resolveStripeProvider(
    cart.region?.payment_providers,
    process.env.STRIPE_PAGE_PROVIDER
  )
  if (!provider) {
    return {
      ok: false,
      status: 400,
      error: "No Stripe payment provider is enabled for this cart's region",
    }
  }

  // Ensure a payment collection.
  let pcId: string | undefined = cart.payment_collection?.id
  if (!pcId) {
    const { result } = await createPaymentCollectionForCartWorkflow(scope).run({
      input: { cart_id: cartId },
    })
    pcId = (result as any).id
  }

  // Ensure a Stripe session (initiatePayment → creates the PaymentIntent).
  let session = findStripeSession(cart.payment_collection?.payment_sessions)
  if (!session) {
    await createPaymentSessionsWorkflow(scope).run({
      input: { payment_collection_id: pcId!, provider_id: provider },
    })
    cart = await readCart()
    session = findStripeSession(cart?.payment_collection?.payment_sessions)
  }

  if (!session) {
    return { ok: false, status: 502, error: "Failed to initialize a Stripe payment session" }
  }

  return {
    ok: true,
    provider_id: session.provider_id,
    payment_session_id: session.id,
    client_secret: (session.data?.client_secret as string) ?? null,
    amount: session.amount ?? cart.total,
    currency_code: session.currency_code ?? cart.currency_code,
  }
}
