"use client"

import { Button, Text } from "@medusajs/ui"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import { convertToLocale } from "@lib/util/money"
import { acceptQuote } from "@lib/data/quotes"
import type { QuoteAcceptance } from "@lib/data/quotes"

/**
 * Accept the quote and go to checkout (#1439 S11).
 *
 * ## The conventional route
 *
 * There is no bespoke payment screen here. Accepting builds a real Medusa cart
 * — the buyer's own customer, their price list, a freight option minted in the
 * lane the quote was rated in — and hands them to the storefront's normal
 * checkout. Every provider, every totals rule and every completion path is then
 * the one the shop already uses and already tests.
 *
 * ## Two refusals worth reading
 *
 * 🔴 `can_accept` is the BACKEND's verdict, not a guess made here. A quote
 * whose freight was named by hand on a lane that rated nothing has no shipping
 * option to carry into the cart, so it can be quoted and cannot be accepted.
 * Rendering a button that 500s on click is how a buyer decides the supplier is
 * not serious — the reason is shown instead.
 *
 * 🔴 The redirect happens only after the server action returns. The cart cookie
 * is written inside that response, so navigating first lands the buyer on a
 * checkout with an empty cart — the same trap as add-to-cart.
 */
const QuoteAcceptPanel = ({
  token,
  acceptance,
  countryCode,
}: {
  token: string
  acceptance: QuoteAcceptance
  countryCode: string
}) => {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const money = (amount: number | null) =>
    amount === null
      ? "—"
      : convertToLocale({ amount, currency_code: acceptance.currency_code })

  const go = () => {
    setError(null)
    startTransition(async () => {
      const { cart_id, error } = await acceptQuote(token)
      if (!cart_id) {
        setError(error ?? "The order could not be started.")
        return
      }
      // `refresh` first: the quote is now accepted, and the server component
      // above should not keep rendering an un-accepted document behind us.
      router.refresh()
      router.push(`/${countryCode}/checkout?step=address`)
    })
  }

  if (acceptance.accepted) {
    return (
      <div className="mt-10 rounded-lg border border-ui-border-base bg-ui-bg-subtle p-6">
        <Text className="txt-medium-plus text-ui-fg-base">
          You have accepted this quote
        </Text>
        <Text className="txt-small text-ui-fg-subtle mt-1">
          Your order is waiting at checkout with these prices held. Opening it
          again will not create a second order.
        </Text>
        <Button
          variant="secondary"
          className="mt-4"
          onClick={() => router.push(`/${countryCode}/checkout?step=address`)}
        >
          Continue to checkout
        </Button>
      </div>
    )
  }

  if (!acceptance.can_accept) {
    return (
      <div className="mt-10 rounded-lg border border-ui-border-base bg-ui-bg-subtle p-6">
        <Text className="txt-medium-plus text-ui-fg-base">
          This quote cannot be ordered online
        </Text>
        <Text className="txt-small text-ui-fg-subtle mt-1">
          {acceptance.blocked_reason}
        </Text>
      </div>
    )
  }

  return (
    <div className="mt-10 rounded-lg border border-ui-border-base p-6">
      <Text className="txt-medium-plus text-ui-fg-base">Ready to order?</Text>

      {/* The split is stated BEFORE the button, not on the next screen. The one
          thing a buyer must not discover at a payment page is how much of the
          total is being asked for now. */}
      <dl className="mt-4 flex flex-col gap-y-2">
        <div className="flex items-center justify-between">
          <dt className="txt-small text-ui-fg-subtle">
            Pay now — {acceptance.deposit_pct}% deposit
          </dt>
          <dd className="txt-medium-plus text-ui-fg-base">
            {money(acceptance.deposit_amount)}
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="txt-small text-ui-fg-subtle">Balance, before dispatch</dt>
          <dd className="txt-medium text-ui-fg-subtle">
            {money(acceptance.balance_amount)}
          </dd>
        </div>
        <div className="flex items-center justify-between border-t border-ui-border-base pt-2">
          <dt className="txt-small-plus text-ui-fg-base">Order total</dt>
          <dd className="txt-medium-plus text-ui-fg-base">
            {money(acceptance.total_due)}
          </dd>
        </div>
      </dl>

      <Button
        className="mt-5 w-full"
        isLoading={pending}
        disabled={pending}
        onClick={go}
      >
        Accept and order
      </Button>

      <Text className="txt-small text-ui-fg-muted mt-3">
        Accepting holds these prices for your order. You will confirm your
        delivery address and pay the deposit at checkout.
      </Text>

      {error ? (
        <div className="mt-4 rounded-md border border-ui-tag-red-border bg-ui-tag-red-bg p-3">
          <Text className="txt-small text-ui-tag-red-text">{error}</Text>
        </div>
      ) : null}
    </div>
  )
}

export default QuoteAcceptPanel
