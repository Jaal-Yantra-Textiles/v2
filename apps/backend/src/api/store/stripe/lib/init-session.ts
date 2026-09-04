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
import { createPaymentSessionsWorkflow } from "@medusajs/medusa/core-flows"

import { ensureCartPaymentCollection } from "../../../../lib/payments/ensure-cart-collection"
import { saveCardSessionData } from "../../../../lib/payments/save-card-intent"
import {
  resolvePartnerConnect,
  connectContext,
} from "../../../../modules/stripe-connect-payment/lib/resolve-connect"

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
        "sales_channel_id",
        /**
         * 🔴 Without this the guard below is dead — a field the query never
         * fetched cannot be read, and the session would go on being created
         * with no customer, silently, exactly as it did before.
         */
        "customer_id",
        "region.payment_providers.id",
        "region.payment_providers.is_enabled",
        "payment_collection.id",
        // #1451 — the seam refuses rather than reuse a collection whose amount
        // disagrees with the payment schedule, so it must be able to see it.
        "payment_collection.amount",
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

  /**
   * Ensure a payment collection FOR THE RIGHT AMOUNT (#1451).
   *
   * This used to call core's `createPaymentCollectionForCartWorkflow`, which
   * hardcodes `amount: cart.raw_total`. On a quote acceptance that ignored the
   * deposit the buyer had just been promised and charged the whole total.
   * `ensureCartPaymentCollection` makes that decision once, for both rails.
   */
  const { id: pcId, plan } = await ensureCartPaymentCollection(scope, cart)

  // Ensure a Stripe session (initiatePayment → creates the PaymentIntent).
  let session = findStripeSession(cart.payment_collection?.payment_sessions)
  if (!session) {
    // Resolve the partner's connected account here (we have query access) and
    // hand it to the provider via context — the provider's isolated container
    // can't resolve it. Harmless for the plain Stripe/system providers.
    const connect = await resolvePartnerConnect(
      scope,
      cart.sales_channel_id,
      Number(process.env.STRIPE_CONNECT_DEFAULT_FEE_PERCENT) || 0
    )
    await createPaymentSessionsWorkflow(scope).run({
      input: {
        payment_collection_id: pcId!,
        provider_id: provider,
        /**
         * 🔴 This path passed NO `customer_id` at all, so core's
         * `when("customer-id-exists")` never fired and no Stripe Customer was
         * ever created here — for guests or signed-in buyers alike.
         *
         * Without a Stripe Customer the card cannot be attached, and an
         * unattached card cannot be charged later. Nothing complains at the
         * time: the intent still reports `setup_future_usage`, still confirms,
         * still reaches `requires_capture`. The refusal arrives at the balance.
         */
        customer_id: cart.customer_id ?? undefined,
        /**
         * Keep the card only when a balance is still owed — see
         * `save-card-intent.ts`. Spread, so a full-payment cart sends no key
         * at all rather than an explicit `undefined` the provider forwards.
         */
        data: { ...saveCardSessionData(plan) },
        context: {
          sales_channel_id: cart.sales_channel_id,
          ...connectContext(connect),
        },
      },
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
