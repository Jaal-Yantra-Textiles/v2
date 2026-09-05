import { retrieveCart, retrieveQuoteTerms } from "@lib/data/cart"
import { retrieveCustomer } from "@lib/data/customer"
import PaymentWrapper from "@modules/checkout/components/payment-wrapper"
import { CartUpdateProvider } from "@modules/checkout/context/cart-update-context"
import CheckoutForm from "@modules/checkout/templates/checkout-form"
import CheckoutSummary from "@modules/checkout/templates/checkout-summary"
import { Metadata } from "next"

import { notFound } from "next/navigation"

export const metadata: Metadata = {
  title: "Checkout",
  robots: { index: false, follow: false },
}

export default async function Checkout(props: {
  params: Promise<{ countryCode: string }>
}) {
  const { countryCode } = await props.params
  const cart = await retrieveCart()

  if (!cart) {
    return notFound()
  }

  // #1787 — the deposit must be visible here, not first met at Review.
  const [customer, quoteTerms] = await Promise.all([
    retrieveCustomer(),
    retrieveQuoteTerms(cart.id),
  ])

  return (
    <PaymentWrapper cart={cart}>
      <CartUpdateProvider>
        <div className="overflow-x-hidden">
          <div className="lg:content-container flex flex-col lg:grid lg:grid-cols-[7fr_5fr] min-h-screen">
            <CheckoutForm
              cart={cart}
              customer={customer}
              countryCode={countryCode}
            />
            <CheckoutSummary cart={cart} quoteTerms={quoteTerms} />
          </div>
        </div>
      </CartUpdateProvider>
    </PaymentWrapper>
  )
}