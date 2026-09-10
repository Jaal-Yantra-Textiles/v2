"use client"

import { Elements } from "@stripe/react-stripe-js"
import { loadStripe } from "@stripe/stripe-js"
import { Text } from "@medusajs/ui"

import PayCollectionForm from "./pay-collection-form"

/**
 * Mounts Stripe for the payment-collection page (#1985).
 *
 * 🔴 This file exists because `loadStripe()` CANNOT live in the page.
 *
 * The page is a server component. Calling `loadStripe()` there runs it on the
 * server and yields a Promise wrapping a browser-only Stripe object, which
 * cannot cross the RSC boundary as a prop. Nothing throws and nothing is logged
 * — `<Elements>` simply never initialises, `useStripe()` returns null, and the
 * page renders a permanently DISABLED Pay button with no card form and no
 * error. It looked completely fine in SSR HTML: correct title, correct amount,
 * `client_secret` present in the payload. Only opening it in a browser showed
 * the form was missing.
 *
 * So the boundary is here: the server passes a plain STRING, and everything
 * Stripe happens client-side. This mirrors `payment-wrapper/index.tsx`, which
 * is `"use client"` for exactly the same reason.
 */
const stripeKey =
  process.env.NEXT_PUBLIC_STRIPE_KEY ||
  process.env.NEXT_PUBLIC_MEDUSA_PAYMENTS_PUBLISHABLE_KEY

const medusaAccountId = process.env.NEXT_PUBLIC_MEDUSA_PAYMENTS_ACCOUNT_ID

const stripePromise = stripeKey
  ? loadStripe(
      stripeKey,
      medusaAccountId ? { stripeAccount: medusaAccountId } : undefined
    )
  : null

export default function PayCollectionWrapper({
  clientSecret,
  amountLabel,
}: {
  clientSecret: string
  amountLabel: string
}) {
  /**
   * A missing key is an operator problem, not a buyer problem. `StripeWrapper`
   * THROWS on it, which would take the page down; here it degrades to a line
   * the buyer can act on. (Local dev hit exactly this: an empty
   * `NEXT_PUBLIC_STRIPE_KEY=` line, which `grep -q` and `||` both read as
   * "present".)
   */
  if (!stripePromise || !stripeKey) {
    return (
      <Text className="text-ui-fg-subtle">
        This payment link cannot be opened just now. Please reply to your order
        email and we will send a new one.
      </Text>
    )
  }

  return (
    <Elements options={{ clientSecret }} stripe={stripePromise}>
      <PayCollectionForm amountLabel={amountLabel} />
    </Elements>
  )
}
