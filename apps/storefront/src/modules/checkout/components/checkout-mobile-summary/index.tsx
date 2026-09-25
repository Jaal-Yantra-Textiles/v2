import type { HttpTypes } from "@medusajs/types"

import { convertToLocale } from "@lib/util/money"
import CheckoutItemList from "@modules/checkout/components/checkout-item-list"
import CheckoutTotals from "@modules/checkout/components/checkout-totals"
import QuoteCartNotice from "@modules/cart/components/quote-cart-notice"
import type { QuoteCartTerms } from "types/quote-terms"

/**
 * What you are buying, and what it costs — at the TOP, on a phone.
 *
 * The checkout is `lg:grid-cols-[7fr_5fr]` and stacks below `lg`, so on a
 * phone the summary column lands under Delivery, Shipping address and Contact:
 * the buyer is asked for an address and a card before ever being shown the
 * amount, and has to scroll past the whole form to check what is in the order.
 * Moving the composition up beside the totals fixed that on the desktop and
 * made it worse on mobile, because the composition went with it.
 *
 * Collapsed by default, because the total is the thing that must be visible
 * and a phone screen is mostly form. The header carries the amount, so the
 * common question is answered without opening anything.
 *
 * 🔑 A native `<details>`, not React state. It costs no client JS, it is
 * keyboard- and screen-reader-operable for free, and it still works if
 * hydration has not run — which on a checkout opened from an email on a cold
 * mobile connection is a real moment, not a hypothetical.
 */
const CheckoutMobileSummary = ({
  cart,
  quoteTerms,
}: {
  cart: HttpTypes.StoreCart
  /** #1787 — null for an ordinary cart. */
  quoteTerms?: QuoteCartTerms | null
}) => {
  const itemCount = cart.items?.length ?? 0

  if (!itemCount) {
    return null
  }

  return (
    <details
      className="group border-b border-ui-border-base bg-neutral-100 lg:hidden"
      data-testid="checkout-mobile-summary"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-x-3 px-4 py-4 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-x-1.5 txt-medium text-ui-fg-interactive">
          <span>Order summary</span>
          <span className="txt-compact-small text-ui-fg-muted">
            ({itemCount} item{itemCount === 1 ? "" : "s"})
          </span>
          {/* Rotates with the disclosure — the only state this needs. */}
          <svg
            className="h-4 w-4 transition-transform group-open:rotate-180"
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M6 8l4 4 4-4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>

        <span className="txt-medium-plus text-ui-fg-base">
          {convertToLocale({
            amount: cart.total ?? 0,
            currency_code: cart.currency_code,
          })}
        </span>
      </summary>

      <div className="flex flex-col gap-y-6 px-4 pb-6">
        <CheckoutItemList cart={cart} />
        <CheckoutTotals cart={cart} />

        {/* #1787 — directly under the totals, the moment the buyer has just
            read the full amount. That rule is why this travels with them
            rather than staying in a column a phone never shows. */}
        <QuoteCartNotice terms={quoteTerms ?? null} />
      </div>
    </details>
  )
}

export default CheckoutMobileSummary
