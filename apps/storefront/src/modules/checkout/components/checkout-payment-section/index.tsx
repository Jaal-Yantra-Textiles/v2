"use client"

import { useState, useEffect, useRef, useContext } from "react"
import { initiatePaymentSession, placeOrder } from "@lib/data/cart"
import {
  buildPaymentSessionData,
  isPaymentSessionReady,
  isStripeLike,
  paymentInfoMap,
} from "@lib/constants"
import compareAddresses from "@lib/util/compare-addresses"
import { CreditCard } from "@medusajs/icons"
import type { HttpTypes } from "@medusajs/types"
import { PaymentElement } from "@stripe/react-stripe-js"
import PaymentButton from "@modules/checkout/components/payment-button"
import ErrorMessage from "@modules/checkout/components/error-message"
import SkeletonCardDetails from "@modules/skeletons/components/skeleton-card-details"
import CheckoutBillingSheet from "@modules/checkout/components/checkout-billing-sheet"
import { StripeContext } from "../payment-wrapper/stripe-wrapper"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { clx } from "@medusajs/ui"
import { useRouter, useSearchParams } from "next/navigation"

interface CheckoutPaymentSectionProps {
  cart: HttpTypes.StoreCart
  availablePaymentMethods: { id: string }[]
}

function providerSubLabel(id: string) {
  if (id.includes("stripe")) return "Stripe"
  if (id.includes("paypal")) return "PayPal"
  if (id.includes("payu")) return "PayU"
  return ""
}

export default function CheckoutPaymentSection({
  cart,
  availablePaymentMethods,
}: CheckoutPaymentSectionProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const latestSession = cart.payment_collection?.payment_sessions?.[0]

  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState(
    latestSession?.provider_id ?? ""
  )
  const [error, setError] = useState<string | null>(null)
  const [, setPaymentComplete] = useState(false)
  const [billingOpen, setBillingOpen] = useState(false)
  const [showBillingDetails, setShowBillingDetails] = useState(false)

  const paidByGiftcard = !!(
    (cart as unknown as Record<string, unknown>)?.gift_cards &&
    (
      (cart as unknown as Record<string, unknown>)?.gift_cards as unknown[]
    )?.length > 0 &&
    cart?.total === 0
  )

  // Re-initiate payment session when it gets cleared (e.g. after promo code change)
  useEffect(() => {
    if (
      selectedPaymentMethod &&
      !latestSession &&
      !paidByGiftcard &&
      isPaymentSessionReady(selectedPaymentMethod, cart)
    ) {
      initiatePaymentSession(cart, {
        provider_id: selectedPaymentMethod,
        data: buildPaymentSessionData(selectedPaymentMethod, cart),
      }).catch((e) => setError(e instanceof Error ? e.message : String(e)))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart.payment_collection?.payment_sessions])

  const receiptContextKey = JSON.stringify({
    shippingAddress: cart.shipping_address,
    billingAddress: cart.billing_address,
    email: cart.email,
    shippingOptionIds: cart.shipping_methods?.map((m) => m.shipping_option_id),
    regionId: cart.region?.id,
  })

  const hasMounted = useRef(false)
  useEffect(() => {
    if (!hasMounted.current) {
      hasMounted.current = true
      return
    }

    if (!selectedPaymentMethod || paidByGiftcard) {
      return
    }

    if (!isPaymentSessionReady(selectedPaymentMethod, cart)) {
      return
    }

    const sessionData = buildPaymentSessionData(selectedPaymentMethod, cart)
    if (!sessionData) {
      return
    }

    initiatePaymentSession(cart, {
      provider_id: selectedPaymentMethod,
      data: sessionData,
    }).catch((e) => setError(e instanceof Error ? e.message : String(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receiptContextKey])

  // Stripe redirect return (redirect-based methods send the shopper to Stripe
  // and back to the checkout page with `?redirect_status=...`). On a successful
  // return we finalise the order.
  useEffect(() => {
    const redirectStatus = searchParams.get("redirect_status")
    if (!redirectStatus) return
    if (redirectStatus === "succeeded") {
      placeOrder().catch((err: any) =>
        setError(err?.message ?? "Payment failed")
      )
    } else {
      setError("Payment was not completed. Please try again.")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const handleSelectPayment = async (providerId: string) => {
    setSelectedPaymentMethod(providerId)
    setError(null)

    if (!isPaymentSessionReady(providerId, cart)) {
      return
    }

    try {
      await initiatePaymentSession(cart, {
        provider_id: providerId,
        data: buildPaymentSessionData(providerId, cart),
      })
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const billingAddr = cart.billing_address
  const billingSameAsShipping = !!(
    cart.shipping_address &&
    billingAddr &&
    compareAddresses(cart.shipping_address, billingAddr)
  )
  const billingText = billingAddr
    ? [billingAddr.address_1, billingAddr.city, billingAddr.postal_code]
        .filter(Boolean)
        .join(", ")
    : null

  return (
    <div className="flex flex-col gap-y-6">
      {/* Payment methods */}
      {!paidByGiftcard && availablePaymentMethods.length > 0 && (
        <div className="flex flex-col gap-y-3">
          <h2 className="h2-docs">Payment</h2>

          <div className="flex gap-x-2 overflow-x-auto no-scrollbar pb-1">
            {availablePaymentMethods.map((method) => {
              const info = paymentInfoMap[method.id]
              const isSelected = selectedPaymentMethod === method.id

              return (
                <button
                  key={method.id}
                  type="button"
                  onClick={() => handleSelectPayment(method.id)}
                  className={clx(
                    "flex-shrink-0 w-[111px] p-[10px] rounded-[6px] border text-start transition-colors",
                    isSelected
                      ? "border-ui-border-interactive bg-ui-bg-base"
                      : "border-ui-border-base bg-ui-bg-base hover:border-ui-border-interactive/50"
                  )}
                >
                  <div className="flex flex-col gap-y-2">
                    <div className="w-6 h-6 rounded-full bg-ui-bg-component border border-ui-border-base flex items-center justify-center">
                      {info?.icon || <CreditCard className="w-3 h-3" />}
                    </div>
                    <div className="flex flex-col">
                      <span className="txt-compact-xsmall-plus text-ui-fg-base leading-tight">
                        {info?.title ?? method.id}
                      </span>
                      <span className="txt-compact-xsmall text-ui-fg-subtle">
                        {providerSubLabel(method.id)}
                      </span>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>

          {/* Stripe card input */}
          {isStripeLike(selectedPaymentMethod) && (
            <StripeInlineContainer setError={setError} setPaymentComplete={setPaymentComplete} />
          )}
        </div>
      )}

      {paidByGiftcard && (
        <div className="flex flex-col gap-y-1">
          <h2 className="h2-docs">Payment</h2>
          <p className="txt-compact-small text-ui-fg-subtle">Gift card</p>
        </div>
      )}

      {/* Billing address */}
      {billingSameAsShipping && !showBillingDetails ? (
        <label className="flex items-center gap-x-2 cursor-pointer">
          <input
            type="checkbox"
            checked
            onChange={() => setShowBillingDetails(true)}
            className="w-4 h-4 rounded border-ui-border-base accent-ui-fg-interactive"
          />
          <span className="txt-compact-small text-ui-fg-base">
            Same as shipping address
          </span>
        </label>
      ) : (
        <div className="flex flex-col gap-y-2">
          <div className="flex items-center justify-between">
            <h2 className="h2-docs">Billing address</h2>
            <button
              type="button"
              onClick={() => setBillingOpen(true)}
              className="txt-compact-small-plus text-ui-fg-interactive hover:text-ui-fg-interactive-hover transition-colors"
            >
              Edit
            </button>
          </div>
          {billingText ? (
            <p className="txt-medium text-ui-fg-base">{billingText}</p>
          ) : (
            <p className="txt-compact-small text-ui-fg-subtle">
              Same as shipping address
            </p>
          )}
        </div>
      )}

      <CheckoutBillingSheet
        open={billingOpen}
        onClose={() => setBillingOpen(false)}
        initialSameAsShipping={billingSameAsShipping && !showBillingDetails}
        onSaved={(sameAsShipping) => setShowBillingDetails(!sameAsShipping)}
        cart={cart}
      />

      <ErrorMessage error={error} data-testid="payment-method-error-message" />

      <div className="flex flex-col gap-y-3">
        <PaymentButton
          cart={cart}
          selectedPaymentMethod={selectedPaymentMethod}
          data-testid="submit-order-button"
        />
        <p className="txt-compact-xsmall text-ui-fg-subtle text-center px-2">
          By clicking the Place Order button, you confirm that you have read,
          understand and accept our Terms of Use, Terms of Sale and Returns
          Policy and acknowledge that you have read our{" "}
          <LocalizedClientLink href="/privacy" className="underline">
            Privacy Policy
          </LocalizedClientLink>
          .
        </p>
      </div>
    </div>
  )
}

function StripeInlineContainer({
  setError,
  setPaymentComplete,
}: {
  setError: (error: string | null) => void
  setPaymentComplete: (complete: boolean) => void
}) {
  const stripeReady = useContext(StripeContext)

  if (!stripeReady) {
    return <SkeletonCardDetails />
  }

  return (
    <div className="mt-2">
      <PaymentElement
        options={{ layout: "accordion" }}
        onChange={(e) => {
          setError(null)
          setPaymentComplete(e.complete)
        }}
        onLoadError={(e) => {
          setPaymentComplete(false)
          setError(e.error?.message ?? "Failed to load payment element")
        }}
      />
    </div>
  )
}