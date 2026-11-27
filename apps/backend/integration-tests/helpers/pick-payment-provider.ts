/**
 * Pick the payment provider a test checkout should authorize with (#1176).
 *
 * `GET /store/payment-providers` returns every provider enabled for the region,
 * and its order is not a contract. Fixtures that grabbed `providers[0]` were
 * really assuming "the only provider is the system default" — true only while
 * no other provider is registered.
 *
 * `medusa-config.ts` registers the Stripe provider whenever `STRIPE_API_KEY` is
 * present, so on any machine with a Stripe key in `.env` the list becomes
 * `[pp_stripe_stripe, pp_system_default]`. `providers[0]` then selects Stripe,
 * whose session cannot be authorized without talking to Stripe, and cart
 * completion fails with:
 *
 *   400 "Session: payses_… was not authorized with the provider."
 *
 * CI has no `STRIPE_API_KEY`, so it never saw this — the failure only ever
 * reproduced locally, which is exactly why it went undiagnosed.
 *
 * Fixtures that just need *a* working checkout want the system provider, which
 * auto-authorizes. Tests that specifically exercise Stripe should ask for it by
 * id rather than use this helper.
 */
export const SYSTEM_PAYMENT_PROVIDER_ID = "pp_system_default"

type PaymentProviderLike = { id: string }

export const pickTestPaymentProvider = <T extends PaymentProviderLike>(
  providers: T[] | undefined | null
): T | undefined => {
  const list = providers || []
  return list.find((p) => p?.id === SYSTEM_PAYMENT_PROVIDER_ID) || list[0]
}

/**
 * Mark a collection's system-provider session as PAID OUT OF BAND (2026-11-27).
 *
 * The system provider auto-authorizes, so fixtures use it as "the buyer paid".
 * It is also the CASH provider: since courier cash on delivery, completing a
 * courier cart on it is refused unless the PIN/cap rules allow cash, and an
 * allowed one is stamped COD for the courier to collect. A fixture that means
 * "paid" says so with the same server-only marker a paid PayU link sets
 * (`external_payment`), which the store payment-sessions route strips from
 * buyer data — so this runs server-side.
 *
 * 🔑 It RE-CREATES the session: `updatePaymentSession` on the system provider
 * replaces the data with the provider's `{}`, so an update would drop the
 * marker. Creating a session keeps caller data (and replaces the old one).
 */
export async function markSystemSessionPaidOutOfBand(
  container: any,
  paymentCollectionId: string
): Promise<void> {
  const { createPaymentSessionsWorkflow } = await import("@medusajs/medusa/core-flows")
  await createPaymentSessionsWorkflow(container).run({
    input: {
      payment_collection_id: paymentCollectionId,
      provider_id: SYSTEM_PAYMENT_PROVIDER_ID,
      data: { external_payment: { source: "test-fixture" } },
    },
  })
}
