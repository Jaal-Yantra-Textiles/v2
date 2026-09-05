"use client"

import { convertToLocale } from "@lib/util/money"
import type { HttpTypes } from "@medusajs/types"
import { useCartUpdate } from "@modules/checkout/context/cart-update-context"

const CheckoutTotals = ({ cart }: { cart: HttpTypes.StoreCart }) => {
  const { isCartUpdating } = useCartUpdate()

  const { currency_code, total, item_subtotal, shipping_subtotal, tax_total } =
    cart
  const { discount_subtotal } = cart as typeof cart & {
    discount_subtotal?: number
  }
  const itemCount = cart.items?.length ?? 0

  return (
    <div className="flex flex-col gap-y-3">
      <div className="flex flex-col txt-medium text-ui-fg-subtle">
        <div className="flex items-center justify-between">
          <span>Items ({itemCount})</span>
          <span data-testid="cart-subtotal">
            {convertToLocale({
              amount: item_subtotal ?? 0,
              currency_code,
            })}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span>Shipping</span>
          <span data-testid="cart-shipping">
            {convertToLocale({
              amount: shipping_subtotal ?? 0,
              currency_code,
            })}
          </span>
        </div>

        {!!discount_subtotal && (
          <div className="flex items-center justify-between">
            <span>Discount</span>
            <span className="text-ui-fg-interactive" data-testid="cart-discount">
              - {convertToLocale({ amount: discount_subtotal, currency_code })}
            </span>
          </div>
        )}

        {!!tax_total && (
          <div className="flex items-center justify-between">
            <span>Taxes</span>
            <span data-testid="cart-taxes">
              {convertToLocale({ amount: tax_total, currency_code })}
            </span>
          </div>
        )}
      </div>

      <div className="h-px bg-ui-border-base" />

      <div className="flex items-center justify-between">
        <h2 className="h2-docs">Total</h2>
        {isCartUpdating ? (
          <span
            className="inline-block w-28 h-7 rounded-xl bg-ui-border-base animate-pulse"
            data-testid="cart-total-skeleton"
          />
        ) : (
          <span className="txt-xlarge-plus text-ui-fg-base" data-testid="cart-total">
            {convertToLocale({ amount: total ?? 0, currency_code })}
          </span>
        )}
      </div>
    </div>
  )
}

export default CheckoutTotals