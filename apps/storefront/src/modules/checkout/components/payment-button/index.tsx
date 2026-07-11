"use client"

import { isManual, isPayU, isStripeLike } from "@lib/constants"
import { placeOrder } from "@lib/data/cart"
import { HttpTypes } from "@medusajs/types"
import { Button } from "@medusajs/ui"
import { useElements, useStripe } from "@stripe/react-stripe-js"
import React, { useState } from "react"
import ErrorMessage from "../error-message"

type PaymentButtonProps = {
  cart: HttpTypes.StoreCart
  "data-testid": string
}

const PaymentButton: React.FC<PaymentButtonProps> = ({
  cart,
  "data-testid": dataTestId,
}) => {
  const notReady =
    !cart ||
    !cart.shipping_address ||
    !cart.billing_address ||
    !cart.email ||
    (cart.shipping_methods?.length ?? 0) < 1

  const paymentSession = cart.payment_collection?.payment_sessions?.[0]

  switch (true) {
    case isStripeLike(paymentSession?.provider_id):
      return (
        <StripePaymentButton
          notReady={notReady}
          cart={cart}
          data-testid={dataTestId}
        />
      )
    case isPayU(paymentSession?.provider_id):
      return (
        <PayUPaymentButton
          notReady={notReady}
          cart={cart}
          data-testid={dataTestId}
        />
      )
    case isManual(paymentSession?.provider_id):
      return (
        <ManualTestPaymentButton notReady={notReady} data-testid={dataTestId} />
      )
    default:
      return <Button disabled>Select a payment method</Button>
  }
}

const PayUPaymentButton = ({
  cart,
  notReady,
  "data-testid": dataTestId,
}: {
  cart: HttpTypes.StoreCart
  notReady: boolean
  "data-testid"?: string
}) => {
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const session = cart.payment_collection?.payment_sessions?.find(
    (s) => s.status === "pending"
  )

  const handlePayment = async () => {
    setSubmitting(true)
    setErrorMessage(null)

    try {
      const payuData = session?.data as Record<string, any> | undefined

      if (!payuData?.payment_url || !payuData?.hash) {
        throw new Error("PayU payment session not initialized")
      }

      // Create a form and submit to PayU
      const form = document.createElement("form")
      form.method = "POST"
      form.action = payuData.payment_url

      // Use the exact same values that were used to generate the hash
      const fields: Record<string, string> = {
        key: payuData.key || "",
        txnid: payuData.txnid || "",
        amount: payuData.amount || "",
        productinfo: payuData.productinfo || "",
        firstname: payuData.firstname || "",
        email: payuData.email || "",
        phone: payuData.phone || cart.billing_address?.phone || "",
        hash: payuData.hash || "",
        surl: `${window.location.origin}/api/payu/success?cart_id=${cart.id}`,
        furl: `${window.location.origin}/api/payu/failure?cart_id=${cart.id}`,
        udf1: payuData.udf1 || "",
        udf2: "",
        udf3: "",
        udf4: "",
        udf5: "",
      }

      // Lastname is not part of the hash, safe to add from cart
      if (cart.billing_address?.last_name) {
        fields.lastname = cart.billing_address.last_name
      }

      Object.entries(fields).forEach(([name, value]) => {
        const input = document.createElement("input")
        input.type = "hidden"
        input.name = name
        input.value = value
        form.appendChild(input)
      })

      document.body.appendChild(form)
      form.submit()
    } catch (err: any) {
      setErrorMessage(err.message || "Payment failed")
      setSubmitting(false)
    }
  }

  return (
    <>
      <Button
        disabled={notReady || !session}
        onClick={handlePayment}
        size="large"
        isLoading={submitting}
        data-testid={dataTestId}
      >
        Pay with PayU
      </Button>
      <ErrorMessage
        error={errorMessage}
        data-testid="payu-payment-error-message"
      />
    </>
  )
}

const StripePaymentButton = ({
  cart,
  notReady,
  "data-testid": dataTestId,
}: {
  cart: HttpTypes.StoreCart
  notReady: boolean
  "data-testid"?: string
}) => {
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const onPaymentCompleted = async () => {
    await placeOrder()
      .catch((err) => {
        setErrorMessage(err.message)
      })
      .finally(() => {
        setSubmitting(false)
      })
  }

  const stripe = useStripe()
  const elements = useElements()

  const session = cart.payment_collection?.payment_sessions?.find(
    (s) => s.status === "pending"
  )

  const disabled = !stripe || !elements ? true : false

  const handlePayment = async () => {
    setSubmitting(true)

    if (!stripe || !elements || !cart) {
      setSubmitting(false)
      return
    }

    // PaymentElement flow (#985): confirmPayment drives whichever method the
    // shopper picked in the element (cards, SEPA, iDEAL, Bancontact, …).
    // `redirect: "if_required"` keeps cards/wallets in-page and returns the
    // PaymentIntent; redirect-based methods navigate to Stripe and back to
    // `return_url` (the checkout page), where the Payment step's redirect-return
    // effect finalises the order. The billing details Stripe needs are collected
    // by the PaymentElement itself, so we no longer hand-build a payment_method.
    const returnUrl = `${window.location.origin}${window.location.pathname}?step=review`

    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: returnUrl },
      redirect: "if_required",
    })

    if (error) {
      const pi = error.payment_intent
      if (pi && (pi.status === "requires_capture" || pi.status === "succeeded")) {
        onPaymentCompleted()
        return
      }
      setErrorMessage(error.message || null)
      setSubmitting(false)
      return
    }

    if (
      paymentIntent &&
      (paymentIntent.status === "requires_capture" ||
        paymentIntent.status === "succeeded")
    ) {
      onPaymentCompleted()
      return
    }

    setSubmitting(false)
  }

  return (
    <>
      <Button
        disabled={disabled || notReady}
        onClick={handlePayment}
        size="large"
        isLoading={submitting}
        data-testid={dataTestId}
      >
        Place order
      </Button>
      <ErrorMessage
        error={errorMessage}
        data-testid="stripe-payment-error-message"
      />
    </>
  )
}

const ManualTestPaymentButton = ({ notReady }: { notReady: boolean }) => {
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const onPaymentCompleted = async () => {
    await placeOrder()
      .catch((err) => {
        setErrorMessage(err.message)
      })
      .finally(() => {
        setSubmitting(false)
      })
  }

  const handlePayment = () => {
    setSubmitting(true)
    onPaymentCompleted()
  }

  return (
    <>
      <Button
        disabled={notReady}
        isLoading={submitting}
        onClick={handlePayment}
        size="large"
        data-testid="submit-order-button"
      >
        Place order
      </Button>
      <ErrorMessage
        error={errorMessage}
        data-testid="manual-payment-error-message"
      />
    </>
  )
}

export default PaymentButton
