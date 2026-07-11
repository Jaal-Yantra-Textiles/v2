import {
  CONNECT_CHECKOUT_PROVIDER_ID,
  STANDARD_STRIPE_PROVIDER_ID,
  dedupeStripeProviders,
} from "../lib/resolve-connect"

/**
 * Pure decision behind the /store/payment-providers override (#985): collapse
 * the two Stripe providers to a single buyer-facing "Stripe", choosing which to
 * keep by the owning partner's Connect status. The container-bound region→partner
 * resolution is exercised via the store integration spec; here we lock the pure
 * selection so the India-partner-in-EU-region case can't regress.
 */

const P = (...ids: string[]) => ids.map((id) => ({ id }))
const ids = (list: Array<{ id?: string | null }>) => list.map((p) => p.id)

describe("dedupeStripeProviders", () => {
  it("connected partner: keeps Connect, drops standard", () => {
    const out = dedupeStripeProviders(
      P(STANDARD_STRIPE_PROVIDER_ID, CONNECT_CHECKOUT_PROVIDER_ID, "pp_payu_payu"),
      true
    )
    expect(ids(out)).toEqual([CONNECT_CHECKOUT_PROVIDER_ID, "pp_payu_payu"])
  })

  it("NOT connected (e.g. India partner in an EU region): keeps standard, drops Connect", () => {
    const out = dedupeStripeProviders(
      P(STANDARD_STRIPE_PROVIDER_ID, CONNECT_CHECKOUT_PROVIDER_ID),
      false
    )
    expect(ids(out)).toEqual([STANDARD_STRIPE_PROVIDER_ID])
  })

  it("preserves order and leaves non-Stripe providers untouched", () => {
    const out = dedupeStripeProviders(
      P("pp_payu_payu", STANDARD_STRIPE_PROVIDER_ID, "pp_system_default", CONNECT_CHECKOUT_PROVIDER_ID),
      true
    )
    expect(ids(out)).toEqual(["pp_payu_payu", "pp_system_default", CONNECT_CHECKOUT_PROVIDER_ID])
  })

  it("never strands a region: only one Stripe present → kept regardless of status", () => {
    // Connected but only standard linked → keep it (don't drop the sole option).
    expect(ids(dedupeStripeProviders(P(STANDARD_STRIPE_PROVIDER_ID), true))).toEqual([
      STANDARD_STRIPE_PROVIDER_ID,
    ])
    // Not connected but only Connect linked → keep it.
    expect(ids(dedupeStripeProviders(P(CONNECT_CHECKOUT_PROVIDER_ID), false))).toEqual([
      CONNECT_CHECKOUT_PROVIDER_ID,
    ])
  })

  it("no Stripe providers at all → unchanged", () => {
    expect(ids(dedupeStripeProviders(P("pp_payu_payu", "pp_system_default"), true))).toEqual([
      "pp_payu_payu",
      "pp_system_default",
    ])
    expect(ids(dedupeStripeProviders([], false))).toEqual([])
  })

  it("tolerates rows without an id", () => {
    const out = dedupeStripeProviders(
      [{ id: null }, { id: STANDARD_STRIPE_PROVIDER_ID }, { id: CONNECT_CHECKOUT_PROVIDER_ID }],
      false
    )
    expect(ids(out)).toEqual([null, STANDARD_STRIPE_PROVIDER_ID])
  })
})
