"use client"

import { Heading, Text, clx } from "@medusajs/ui"

import { convertToLocale } from "@lib/util/money"

import PaymentButton from "../payment-button"
import { useSearchParams } from "next/navigation"

const Review = ({ cart }: { cart: any }) => {
  const searchParams = useSearchParams()

  const isOpen = searchParams.get("step") === "review"

  const paidByGiftcard =
    cart?.gift_cards && cart?.gift_cards?.length > 0 && cart?.total === 0

  /**
   * The amount actually being collected now, when it is LESS than the cart
   * total — i.e. this is a deposit. Null for an ordinary cart, which must look
   * exactly as it did before.
   *
   * `payment_collection.amount` is the figure the gateway will sign, so
   * deriving the copy from it means the two cannot disagree. Guarded on a
   * finite number: an unfetched or absent collection must render nothing
   * rather than "Pay now NaN".
   */
  const collectionAmount = Number(cart?.payment_collection?.amount)
  const cartTotal = Number(cart?.total)
  const depositDue =
    Number.isFinite(collectionAmount) &&
    Number.isFinite(cartTotal) &&
    collectionAmount > 0 &&
    collectionAmount < cartTotal
      ? collectionAmount
      : null

  const previousStepsCompleted =
    cart.shipping_address &&
    cart.shipping_methods.length > 0 &&
    (cart.payment_collection || paidByGiftcard)

  return (
    <div className="bg-white">
      <div className="flex flex-row items-center justify-between mb-6">
        <Heading
          level="h2"
          className={clx(
            "flex flex-row text-3xl-regular gap-x-2 items-baseline",
            {
              "opacity-50 pointer-events-none select-none": !isOpen,
            }
          )}
        >
          Review
        </Heading>
      </div>
      {isOpen && previousStepsCompleted && (
        <>
          {/*
            #1451 — when this cart is a quote acceptance, the buyer pays a
            DEPOSIT now and a balance later. Say so before they press the
            button: the order summary beside this shows the full total, and a
            card charged for a third of it with no explanation reads as a
            broken checkout at best and a wrong charge at worst.

            🔑 Derived from the payment collection's OWN amount — the number
            that will actually be charged — rather than from the schedule.
            Anything else can disagree with the charge; this cannot.
          */}
          {depositDue !== null && (
            <div
              className="flex flex-col gap-y-1 w-full mb-6 p-4 rounded-lg bg-ui-bg-subtle border border-ui-border-base"
              data-testid="deposit-notice"
            >
              <div className="flex items-center justify-between">
                <Text className="txt-medium-plus text-ui-fg-base">
                  Pay now (deposit)
                </Text>
                <Text className="txt-medium-plus text-ui-fg-base" data-testid="deposit-amount">
                  {convertToLocale({ amount: depositDue, currency_code: cart.currency_code })}
                </Text>
              </div>
              <div className="flex items-center justify-between">
                <Text className="txt-medium text-ui-fg-subtle">Balance</Text>
                <Text className="txt-medium text-ui-fg-subtle" data-testid="balance-amount">
                  {convertToLocale({
                    amount: cart.total - depositDue,
                    currency_code: cart.currency_code,
                  })}
                </Text>
              </div>
              <Text className="txt-small text-ui-fg-muted mt-1">
                The balance falls due when your order is ready to despatch. We
                will send you a payment link then — nothing is charged
                automatically.
              </Text>
            </div>
          )}

          <div className="flex items-start gap-x-1 w-full mb-6">
            <div className="w-full">
              <Text className="txt-medium-plus text-ui-fg-base mb-1">
                By clicking the Place Order button, you confirm that you have
                read, understand and accept our Terms of Use, Terms of Sale and
                Returns Policy and acknowledge that you have read Medusa
                Store&apos;s Privacy Policy.
              </Text>
            </div>
          </div>
          <PaymentButton cart={cart} data-testid="submit-order-button" />
        </>
      )}
    </div>
  )
}

export default Review
