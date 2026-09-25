import type { HttpTypes } from "@medusajs/types"
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
  return (
    /*
      DESKTOP ONLY. Everything in this column now renders on a phone inside
      `CheckoutMobileSummary`, at the top of the page. Left visible it would
      be an empty grey band below the form, because its two remaining children
      are gated to `lg` and the deposit notice is null for an ordinary cart.
    */
    <div className="hidden lg:flex flex-col gap-y-8 px-4 py-4 lg:py-10 lg:ps-10 bg-neutral-100 lg:-me-[9999px] lg:pe-[9999px]">
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
      <CheckoutItemList cart={cart} />

      <CheckoutTotals cart={cart} />

      {/* Directly under the totals: the buyer has just read the full amount,
          and this is the moment the "due today" figure has to appear. */}
      <QuoteCartNotice terms={quoteTerms ?? null} />

    </div>
  )
}

export default CheckoutSummary