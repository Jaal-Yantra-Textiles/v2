import ItemsTemplate from "./items"
import Summary from "./summary"
import EmptyCartMessage from "../components/empty-cart-message"
import SignInPrompt from "../components/sign-in-prompt"
import Divider from "@modules/common/components/divider"
import { HttpTypes } from "@medusajs/types"
import QuoteCartNotice from "../components/quote-cart-notice"
import type { QuoteCartTerms } from "types/quote-terms"

const CartTemplate = ({
  cart,
  customer,
  quoteTerms,
}: {
  cart: HttpTypes.StoreCart | null
  customer: HttpTypes.StoreCustomer | null
  /** #1787 — null for an ordinary cart. */
  quoteTerms?: QuoteCartTerms | null
}) => {
  return (
    <div className="py-12">
      <div className="content-container" data-testid="cart-container">
        {cart?.items?.length ? (
          <div className="grid grid-cols-1 small:grid-cols-[1fr_360px] gap-x-40">
            <div className="flex flex-col bg-white py-6 gap-y-6">
              {/* Above the line items on purpose: "these prices are held, and
                  this is what you pay today" is context for everything below
                  it, and a buyer who scrolls past the basket to the total has
                  already formed an expectation by then. */}
              <QuoteCartNotice terms={quoteTerms ?? null} />
              {!customer && (
                <>
                  <SignInPrompt />
                  <Divider />
                </>
              )}
              <ItemsTemplate cart={cart} />
            </div>
            <div className="relative">
              <div className="flex flex-col gap-y-8 sticky top-12">
                {cart && cart.region && (
                  <>
                    <div className="bg-white py-6">
                      <Summary cart={cart as any} />
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div>
            <EmptyCartMessage />
          </div>
        )}
      </div>
    </div>
  )
}

export default CartTemplate
