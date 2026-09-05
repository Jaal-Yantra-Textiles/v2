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
import {
  foldPaymentMethods,
  hasExpressMethods,
  shouldShowMethodChooser,
} from "@lib/util/payment-methods"
import { CreditCard } from "@medusajs/icons"
import type { HttpTypes } from "@medusajs/types"
import {
  ExpressCheckoutElement,
  LinkAuthenticationElement,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js"
import type {
  StripeExpressCheckoutElementConfirmEvent,
  StripeExpressCheckoutElementReadyEvent,
} from "@stripe/stripe-js"
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
  // Only the method-specific Stripe providers need a qualifier ("iDeal" /
  // "Bancontact" → "via Stripe"). The generic providers (Stripe, PayU, PayPal)
  // already carry their own title, so a sub-label would just repeat it.
  if (id === "pp_stripe-ideal_stripe" || id === "pp_stripe-bancontact_stripe") {
    return "Stripe"
  }
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

  /**
   * What the shopper is asked to choose between — providers folded to real
   * choices. A region with one way to pay gets no chooser at all: the tile
   * said "Stripe", which is the processor's name and not an answer to "how am
   * I paying?", and it sat above the card field doing nothing.
   */
  const buyerMethods = foldPaymentMethods(
    availablePaymentMethods,
    latestSession?.provider_id
  )
  const showMethodChooser = shouldShowMethodChooser(buyerMethods)

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

  /**
   * With no chooser there is nobody to click the tile, so the single method is
   * selected here and its session opened — otherwise the card field would wait
   * forever for a selection that cannot be made.
   *
   * ⚠️ Guarded on `!selectedPaymentMethod`: this must fire once, not on every
   * render, and never over a selection the shopper (or a live session) already
   * has.
   */
  useEffect(() => {
    if (showMethodChooser || paidByGiftcard) return
    if (selectedPaymentMethod) return
    const only = buyerMethods[0]
    if (!only) return
    void handleSelectPayment(only.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showMethodChooser, paidByGiftcard, selectedPaymentMethod, buyerMethods[0]?.id])

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

          {showMethodChooser && (
          <div className="flex gap-x-2 overflow-x-auto no-scrollbar pb-1">
            {buyerMethods.map((method) => {
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
          )}

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

/**
 * 🔴 The guard has to live in its own component, above the hooks.
 *
 * `useStripe()` THROWS when there is no `<Elements>` provider — it does not
 * return null — so calling it before checking the context took the whole
 * checkout page down with a runtime error rather than showing a skeleton. The
 * check that was meant to prevent that sat two lines too late, which nothing
 * noticed while a shopper had to click a tile before this rendered at all.
 * With the tile gone it renders on load, so a missing `NEXT_PUBLIC_STRIPE_KEY`
 * would break every checkout instead of degrading.
 */
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
    <StripeInlineFields
      setError={setError}
      setPaymentComplete={setPaymentComplete}
    />
  )
}

function StripeInlineFields({
  setError,
  setPaymentComplete,
}: {
  setError: (error: string | null) => void
  setPaymentComplete: (complete: boolean) => void
}) {
  const stripe = useStripe()
  const elements = useElements()

  /**
   * `null` until the Express Checkout element reports. A region where Stripe
   * offers nothing but a card — which is most of them — should show the card
   * and nothing else: no wallet row, and above all no "or pay with card"
   * divider separating the card from an empty space.
   */
  const [expressMethods, setExpressMethods] = useState<
    Record<string, boolean> | undefined | null
  >(null)
  const showExpress = hasExpressMethods(expressMethods)

  const returnUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}${window.location.pathname}`
      : ""

  // Wallet (Apple Pay / Google Pay / Link) confirm — mirrors the regular card
  // button's `stripe.confirmPayment` + placeOrder flow in payment-button.
  const handleExpressConfirm = async (
    event: StripeExpressCheckoutElementConfirmEvent
  ) => {
    if (!stripe || !elements) return

    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: returnUrl },
      redirect: "if_required",
    })

    if (error) {
      const pi = error.payment_intent as
        | { status?: string }
        | undefined
      if (
        pi &&
        (pi.status === "requires_capture" || pi.status === "succeeded")
      ) {
        placeOrder().catch((err: any) =>
          setError(err?.message ?? "Payment failed")
        )
        return
      }
      event.paymentFailed({ reason: "fail", message: error.message })
      setError(error.message ?? "Payment failed")
      return
    }

    if (
      paymentIntent &&
      (paymentIntent.status === "requires_capture" ||
        paymentIntent.status === "succeeded")
    ) {
      placeOrder().catch((err: any) =>
        setError(err?.message ?? "Payment failed")
      )
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-y-4">
      {/*
        ⚠️ Always mounted, never conditionally rendered: `onReady` is the only
        thing that says whether any wallet is available, and an element that is
        not mounted never reports. So it stays in the tree and is collapsed to
        nothing until it says it has something — height, not `display: none`,
        so Stripe can still measure and paint it.
      */}
      <div
        className={
          showExpress
            ? ""
            : // `-mb-4` cancels the parent's `gap-y-4`: a zero-height child is
              // still a flex child, so without it a card-only checkout keeps a
              // 16px hole where the wallets would have been.
              "h-0 overflow-hidden opacity-0 pointer-events-none -mb-4"
        }
      >
        <ExpressCheckoutElement
          options={{
            paymentMethods: {
              applePay: "auto",
              googlePay: "auto",
              link: "auto",
              paypal: "never",
            },
          }}
          onReady={(event: StripeExpressCheckoutElementReadyEvent) =>
            setExpressMethods(event.availablePaymentMethods)
          }
          onConfirm={handleExpressConfirm}
        />
      </div>

      {/*
        The divider and the Link email box exist to separate the wallets from
        the card. With no wallets there is nothing to separate, and the shopper
        should just be looking at the card.
      */}
      {showExpress && (
        <>
          <div className="flex items-center gap-x-3">
            <span className="h-px flex-1 bg-ui-border-base" />
            <span className="txt-compact-xsmall text-ui-fg-muted">
              or pay with card
            </span>
            <span className="h-px flex-1 bg-ui-border-base" />
          </div>

          <LinkAuthenticationElement />
        </>
      )}

      <PaymentElement
        options={{
          /**
           * Card open, everything else listed under it.
           *
           * `defaultCollapsed: false` is the half that matters: a collapsed
           * accordion opens on a row of method NAMES, so a shopper who only
           * wants to type a card number has to pick "Card" first. Open, the
           * card fields are already there and the other methods — whatever
           * Stripe offers for this currency — are visible underneath.
           */
          layout: {
            type: "accordion",
            defaultCollapsed: false,
            radios: true,
            spacedAccordionItems: false,
          },
          // Card leads regardless of the order Stripe returns.
          paymentMethodOrder: ["card"],
        }}
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