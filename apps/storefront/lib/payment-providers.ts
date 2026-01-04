/**
 * Payment provider display information
 */

type PaymentProviderInfo = {
  id: string
  name: string
  icon: string
}

const paymentProviders: Record<string, PaymentProviderInfo> = {
  stripe: {
    id: "stripe",
    name: "Credit Card",
    icon: "creditcard.fill",
  },
  paypal: {
    id: "paypal",
    name: "PayPal",
    icon: "dollarsign.circle.fill",
  },
  manual: {
    id: "manual",
    name: "Manual Payment",
    icon: "banknote.fill",
  },
  "pp_system_default": {
    id: "pp_system_default",
    name: "Pay on Delivery",
    icon: "shippingbox.fill",
  },
}

export function getPaymentProviderInfo(providerId: string): PaymentProviderInfo {
  // Extract provider name from ID (e.g., "pp_stripe_stripe" -> "stripe")
  const normalizedId = providerId
    .replace(/^pp_/, "")
    .replace(/_.*$/, "")
    .toLowerCase()

  return (
    paymentProviders[normalizedId] ||
    paymentProviders[providerId] || {
      id: providerId,
      name: providerId.replace(/_/g, " ").replace(/^pp /, ""),
      icon: "creditcard.fill",
    }
  )
}
