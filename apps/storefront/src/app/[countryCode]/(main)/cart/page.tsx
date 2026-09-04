import { retrieveCart, retrieveQuoteTerms } from "@lib/data/cart"
import { retrieveCustomer } from "@lib/data/customer"
import CartTemplate from "@modules/cart/templates"
import { Metadata } from "next"
import { notFound } from "next/navigation"

export const metadata: Metadata = {
  title: "Cart",
  description: "View your cart",
  robots: { index: false, follow: false },
}

export default async function Cart() {
  const cart = await retrieveCart().catch((error) => {
    return notFound()
  })

  const [customer, quoteTerms] = await Promise.all([
    retrieveCustomer(),
    // #1787 — a quote cart must say so, and say what is due TODAY. Null for an
    // ordinary cart, and null if the lookup fails: the plain total is always a
    // correct thing to render.
    retrieveQuoteTerms(cart?.id),
  ])

  return (
    <CartTemplate cart={cart} customer={customer} quoteTerms={quoteTerms} />
  )
}
