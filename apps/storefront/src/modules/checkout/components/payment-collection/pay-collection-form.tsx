"use client"

import { Button, Text } from "@medusajs/ui"
import { PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js"
import { useState } from "react"

/**
 * The Payment Element and Pay button for an outstanding payment collection
 * (#1985).
 *
 * 🔴 `useStripe()` / `useElements()` THROW outside an `<Elements>` provider —
 * not return null, throw — and a throw here takes the whole page down, not just
 * the button. So this component is only ever rendered by the page INSIDE
 * `StripeWrapper`. A `stripeReady` check placed inside this component would sit
 * below the hooks and be reached too late; the guard has to be at the mount
 * site. That mistake killed the checkout page once already.
 */
export default function PayCollectionForm({
  amountLabel,
}: {
  amountLabel: string
}) {
  const stripe = useStripe()
  const elements = useElements()
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [paid, setPaid] = useState(false)

  const handlePay = async () => {
    setSubmitting(true)
    setErrorMessage(null)

    if (!stripe || !elements) {
      setSubmitting(false)
      return
    }

    /**
     * Back to THIS page. On return it re-reads the collection and renders the
     * paid state, so a buyer who pays through a redirect method (iDEAL,
     * Bancontact, 3DS) lands somewhere that confirms the money arrived rather
     * than on a form asking for it again.
     */
    const returnUrl = `${window.location.origin}${window.location.pathname}`

    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: returnUrl },
      redirect: "if_required",
    })

    // A declined card and an authorised-but-uncaptured intent both arrive as
    // `error`. Only the genuinely failed ones are the buyer's problem.
    if (error) {
      const pi = error.payment_intent
      if (pi && (pi.status === "requires_capture" || pi.status === "succeeded")) {
        setPaid(true)
        return
      }
      setErrorMessage(error.message || "That payment could not be completed.")
      setSubmitting(false)
      return
    }

    if (
      paymentIntent &&
      (paymentIntent.status === "requires_capture" ||
        paymentIntent.status === "succeeded")
    ) {
      setPaid(true)
      return
    }

    setSubmitting(false)
  }

  if (paid) {
    return (
      <div className="rounded-lg border border-ui-border-base bg-ui-bg-subtle p-6">
        <Text className="txt-medium-plus text-ui-fg-base mb-1">
          Payment received
        </Text>
        <Text className="txt-small text-ui-fg-subtle">
          Thank you — {amountLabel} has been paid. You can close this window; a
          confirmation follows by email.
        </Text>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-y-4">
      <PaymentElement options={{ layout: "accordion" }} />

      {errorMessage && (
        <Text
          className="txt-small text-ui-fg-error"
          data-testid="payment-collection-error"
        >
          {errorMessage}
        </Text>
      )}

      <Button
        size="large"
        isLoading={submitting}
        disabled={!stripe || !elements || submitting}
        onClick={handlePay}
        data-testid="pay-collection-button"
      >
        Pay {amountLabel}
      </Button>
    </div>
  )
}
