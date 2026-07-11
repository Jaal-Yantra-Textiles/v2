import React from "react"
import { CreditCard } from "@medusajs/icons"

import Ideal from "@modules/common/icons/ideal"
import Bancontact from "@modules/common/icons/bancontact"
import PayPal from "@modules/common/icons/paypal"

/* Map of payment provider_id to their title and icon. Add in any payment providers you want to use. */
export const paymentInfoMap: Record<
  string,
  { title: string; icon: React.JSX.Element }
> = {
  
  pp_stripe_stripe: {
    title: "Stripe",
    icon: <CreditCard />,
  },
  // Single buyer-facing "Stripe" — Connect (merchant-direct) + standard resolve
  // per the owning partner's onboarding status; the buyer never sees the split (#985).
  "pp_stripe-connect_stripe-connect": {
    title: "Stripe",
    icon: <CreditCard />,
  },
  "pp_medusa-payments_default": {
    title: "Credit card",
    icon: <CreditCard />,
  },
  "pp_stripe-ideal_stripe": {
    title: "iDeal",
    icon: <Ideal />,
  },
  "pp_stripe-bancontact_stripe": {
    title: "Bancontact",
    icon: <Bancontact />,
  },
  pp_paypal_paypal: {
    title: "PayPal",
    icon: <PayPal />,
  },
  pp_system_default: {
    title: "Manual Payment",
    icon: <CreditCard />,
  },
  pp_payu_payu: {
    title: "PayU",
    icon: <CreditCard />,
  },
}

// This checks if it is native stripe, medusa payments, or the Stripe Connect
// provider (the single buyer-facing "Stripe" — #985). It ignores the
// method-specific stripe-based providers (ideal/bancontact), which are handled
// separately.
export const isStripeLike = (providerId?: string) => {
  return (
    providerId?.startsWith("pp_stripe_") ||
    providerId?.startsWith("pp_medusa-") ||
    providerId === "pp_stripe-connect_stripe-connect"
  )
}

export const isPaypal = (providerId?: string) => {
  return providerId?.startsWith("pp_paypal")
}
export const isManual = (providerId?: string) => {
  return providerId?.startsWith("pp_system_default")
}
export const isPayU = (providerId?: string) => {
  return providerId?.startsWith("pp_payu")
}

// Add currencies that don't need to be divided by 100
export const noDivisionCurrencies = [
  "krw",
  "jpy",
  "vnd",
  "clp",
  "pyg",
  "xaf",
  "xof",
  "bif",
  "djf",
  "gnf",
  "kmf",
  "mga",
  "rwf",
  "xpf",
  "htg",
  "vuv",
  "xag",
  "xdr",
  "xau",
]
