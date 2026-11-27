import React from "react"
import { CreditCard } from "@medusajs/icons"
import type { HttpTypes } from "@medusajs/types"

import Ideal from "@modules/common/icons/ideal"
import Bancontact from "@modules/common/icons/bancontact"
import PayPal from "@modules/common/icons/paypal"

/* Map of payment provider_id to their title and icon. Add in any payment providers you want to use. */
export const paymentInfoMap: Record<
  string,
  { title: string; icon: React.JSX.Element }
> = {
  
  // Named for what the shopper does, not for who processes it. "Stripe" told
  // a buyer nothing about how they were paying, and sat above a card field.
  pp_stripe_stripe: {
    title: "Card & more",
    icon: <CreditCard />,
  },
  // Single buyer-facing "Stripe" — Connect (merchant-direct) + standard resolve
  // per the owning partner's onboarding status; the buyer never sees the split (#985).
  "pp_stripe-connect_stripe-connect": {
    title: "Card & more",
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
    title: "Cash on delivery",
    icon: <CreditCard />,
  },
  pp_payu_payu: {
    title: "PayU",
    icon: <CreditCard />,
  },
  // Bitcoin via BTCPay Server. The buyer pays on BTCPay's page; the order is
  // placed once the payment confirms on-chain (10–60 min).
  pp_btcpay_btcpay: {
    title: "Bitcoin",
    icon: (
      <span aria-hidden className="inline-flex h-5 w-5 items-center justify-center font-semibold">
        ₿
      </span>
    ),
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
export const isBtcpay = (providerId?: string) => {
  return providerId?.startsWith("pp_btcpay")
}

/** Where BTCPay sends the buyer after paying (must be https in prod). */
export const btcpayReturnUrl = (cartId: string) =>
  `${window.location.origin}/api/btcpay/return?cart_id=${encodeURIComponent(cartId)}`

const paymentSessionDataBuilders: Array<{
  test: (providerId?: string) => boolean | undefined
  isReady?: (cart: HttpTypes.StoreCart) => boolean
  build: (cart: HttpTypes.StoreCart) => Record<string, unknown>
}> = [
  // Bitcoin: BTCPay sends the buyer back here after paying. The URL carries
  // only the cart id; payment is decided server-side from the invoice.
  {
    test: isBtcpay,
    build: (cart) => ({ return_url: btcpayReturnUrl(cart.id) }),
  },
]

export const buildPaymentSessionData = (
  providerId: string | undefined,
  cart: HttpTypes.StoreCart
) => {
  return paymentSessionDataBuilders.find((b) => b.test(providerId))?.build(cart)
}

export const isPaymentSessionReady = (
  providerId: string | undefined,
  cart: HttpTypes.StoreCart
) => {
  const entry = paymentSessionDataBuilders.find((b) => b.test(providerId))
  return entry?.isReady ? entry.isReady(cart) : true
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
