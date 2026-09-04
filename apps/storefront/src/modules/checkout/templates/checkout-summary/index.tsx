import { Heading } from "@medusajs/ui"

import ItemsPreviewTemplate from "@modules/cart/templates/preview"
import DiscountCode from "@modules/checkout/components/discount-code"
import CartTotals from "@modules/common/components/cart-totals"
import Divider from "@modules/common/components/divider"
import QuoteCartNotice from "@modules/cart/components/quote-cart-notice"
import type { QuoteCartTerms } from "types/quote-terms"

const CheckoutSummary = ({
  cart,
  quoteTerms,
}: {
  cart: any
  /** #1787 — null for an ordinary cart. */
  quoteTerms?: QuoteCartTerms | null
}) => {
  return (
    <div className="sticky top-0 flex flex-col-reverse small:flex-col gap-y-8 py-8 small:py-0 ">
      <div className="w-full bg-white flex flex-col">
        <Divider className="my-6 small:hidden" />
        <Heading
          level="h2"
          className="flex flex-row text-3xl-regular items-baseline"
        >
          In your Cart
        </Heading>
        <Divider className="my-6" />
        {/* Directly under the totals: the buyer has just read the full
            amount, and this is the moment the "due today" figure has to
            appear — not two steps later at Review. */}
        <QuoteCartNotice terms={quoteTerms ?? null} className="mb-6" />
        <CartTotals totals={cart} />
        <ItemsPreviewTemplate cart={cart} />
        <div className="my-6">
          <DiscountCode cart={cart} />
        </div>
      </div>
    </div>
  )
}

export default CheckoutSummary
