/**
 * Providers only have an ID to identify them. This function formats the ID
 * into a human-readable string.
 *
 * Format example: pp_stripe-blik_dkk
 *
 * @param id - The ID of the provider
 * @returns A formatted string
 */
export const formatProvider = (id: string) => {
  // Both Stripe providers surface to buyers/partners as a single "Stripe".
  // `pp_stripe_stripe` (standard) and `pp_stripe-connect_stripe-connect`
  // (Connect) are one payment method chosen by the partner's onboarding status
  // (#985) — the Connect-vs-standard split is an implementation detail nobody
  // configuring a region should have to reason about. Targeted so payu /
  // fulfillment / tax providers keep their "Name (TYPE)" format.
  if (id === "pp_stripe_stripe" || id === "pp_stripe-connect_stripe-connect") {
    return "Stripe"
  }

  const [_, name, type] = id.split("_")
  return (
    name
      .split("-")
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join(" ") + (type ? ` (${type.toUpperCase()})` : "")
  )
}
