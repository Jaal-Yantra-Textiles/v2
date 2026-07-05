/**
 * Normalize an initialized payment session into the concrete next step
 * the client must take, per provider.
 *
 * Reused from the MCP registry — kept here as a standalone so UCP routes
 * can call it without importing the full MCP registry.
 */
export function paymentNextAction(session: any): Record<string, any> {
  const providerId: string = session?.provider_id || ""
  const d: Record<string, any> = session?.data || {}

  if (providerId.includes("payu")) {
    return {
      type: "redirect_form",
      provider: "payu",
      provider_id: providerId,
      description:
        "POST these fields as application/x-www-form-urlencoded to `url` to open PayU's hosted checkout. Finish with the PayU webhook / payu_complete_payment.",
      method: "POST",
      url: d.payment_url ?? null,
      fields: {
        key: d.key ?? null,
        txnid: d.txnid ?? null,
        amount: d.amount ?? null,
        productinfo: d.productinfo ?? null,
        firstname: d.firstname ?? null,
        email: d.email ?? null,
        phone: d.phone ?? null,
        udf1: d.udf1 ?? null,
        hash: d.hash ?? null,
      },
      txnid: d.txnid ?? null,
      upi_link: d.upi_intent_uri ?? null,
    }
  }

  if (providerId.includes("stripe")) {
    return {
      type: "client_secret",
      provider: "stripe",
      provider_id: providerId,
      description:
        "Stripe checkout. Use create_stripe_payment_page for a hosted card page, or hand this client_secret to Stripe.js.",
      client_secret: d.client_secret ?? null,
    }
  }

  return {
    type: "session_ready",
    provider_id: providerId || null,
    description: "Payment session initialized. Once authorized, the cart completes via webhook.",
  }
}

/** Find the just-initialized session (by provider_id) on a payment collection. */
export function pickSession(data: any, providerId: unknown): any {
  const sessions = data?.payment_collection?.payment_sessions || []
  const pid = typeof providerId === "string" ? providerId : ""
  return (
    sessions.find((s: any) => s?.provider_id === pid) ||
    sessions.find((s: any) => pid && String(s?.provider_id || "").includes(pid)) ||
    sessions[sessions.length - 1] ||
    null
  )
}
