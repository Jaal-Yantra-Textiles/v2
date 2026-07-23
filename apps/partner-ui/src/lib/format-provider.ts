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
  // Buyers see a single "Stripe" at checkout (#985), but operators configuring
  // regions/payment-configs need to tell the two apart: `pp_stripe_stripe` is
  // the platform-owned standard Stripe, `pp_stripe-connect_stripe-connect` is
  // the merchant's connected account (Connect). So in the admin/partner-ui we
  // label them distinctly to avoid the "two identical Stripe rows" confusion.
  if (id === "pp_stripe_stripe") {
    return "Stripe"
  }
  if (id === "pp_stripe-connect_stripe-connect") {
    return "Stripe Connect"
  }

  const [_, name, type] = id.split("_")
  return (
    name
      .split("-")
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join(" ") + (type ? ` (${type.toUpperCase()})` : "")
  )
}
