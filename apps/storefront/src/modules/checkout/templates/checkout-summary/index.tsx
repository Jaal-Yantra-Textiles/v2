import { listCartPaymentMethods } from "@lib/data/payment"
import type { HttpTypes } from "@medusajs/types"
import DiscountCode from "@modules/checkout/components/discount-code"
import CheckoutPaymentSection from "@modules/checkout/components/checkout-payment-section"
import CheckoutItemList from "@modules/checkout/components/checkout-item-list"
import CheckoutTotals from "@modules/checkout/components/checkout-totals"
import QuoteCartNotice from "@modules/cart/components/quote-cart-notice"
import type { QuoteCartTerms } from "types/quote-terms"

const CheckoutSummary = async ({
  cart,
  quoteTerms,
}: {
  cart: HttpTypes.StoreCart
  /** #1787 — null for an ordinary cart. */
  quoteTerms?: QuoteCartTerms | null
}) => {
  const paymentMethods = await listCartPaymentMethods(cart.region?.id ?? "")

  return (
    <div className="flex flex-col gap-y-8 px-4 py-4 lg:py-10 lg:ps-10 bg-neutral-100 lg:-me-[9999px] lg:pe-[9999px]">
      {/*
        WHAT is being bought, immediately above WHAT IT COSTS.

        This used to render at the bottom of the form column, below Contact —
        the last thing on the page, far from the totals it explains. A buyer
        checking their order had to scroll past every checkout step to find it.
        Scrolls in place past a few items so it can never push the totals
        off-screen — no dialog to open, and the buyer stays on the page they
        are paying on.
      */}
      {/*
        Desktop only — on a phone these two render at the TOP of the page, in
        `CheckoutMobileSummary`. Rendering them here as well would show the
        buyer the same list and the same total twice on one screen.
      */}
      <div className="hidden lg:flex lg:flex-col lg:gap-y-8">
        <CheckoutItemList cart={cart} />

        <CheckoutTotals cart={cart} />
      </div>

      {/* Directly under the totals: the buyer has just read the full amount,
          and this is the moment the "due today" figure has to appear. */}
      <QuoteCartNotice terms={quoteTerms ?? null} />

      <DiscountCode cart={cart} />

      <CheckoutPaymentSection
        cart={cart}
        availablePaymentMethods={paymentMethods ?? []}
      />
    </div>
  )
}

export default CheckoutSummary