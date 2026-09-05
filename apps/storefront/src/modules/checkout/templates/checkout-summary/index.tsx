import { listCartPaymentMethods } from "@lib/data/payment"
import type { HttpTypes } from "@medusajs/types"
import DiscountCode from "@modules/checkout/components/discount-code"
import CheckoutPaymentSection from "@modules/checkout/components/checkout-payment-section"
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
      <CheckoutTotals cart={cart} />

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