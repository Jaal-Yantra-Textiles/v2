import { listCartShippingMethods } from "@lib/data/fulfillment"
import { listCartPaymentMethods } from "@lib/data/payment"
import { listRegions } from "@lib/data/regions"
import { retrieveCustomerAddresses } from "@lib/data/customer"
import type { HttpTypes } from "@medusajs/types"
import CheckoutShippingSection from "@modules/checkout/components/checkout-shipping-section"
import CheckoutInfoRows from "@modules/checkout/components/checkout-info-rows"
import CheckoutPaymentSection from "@modules/checkout/components/checkout-payment-section"
import DiscountCode from "@modules/checkout/components/discount-code"
import SignInPrompt from "@modules/checkout/components/sign-in-prompt"

export default async function CheckoutForm({
  cart,
  customer,
  countryCode,
}: {
  cart: HttpTypes.StoreCart | null
  customer: HttpTypes.StoreCustomer | null
  countryCode: string
}) {
  if (!cart) return null

  const [shippingOptions, regions, addresses, paymentMethods] =
    await Promise.all([
      listCartShippingMethods(cart.id),
      listRegions(),
      retrieveCustomerAddresses(),
      listCartPaymentMethods(cart.region?.id ?? ""),
    ])

  const resolvedCountry =
    countryCode ||
    cart.shipping_address?.country_code ||
    cart.region?.countries?.[0]?.iso_2 ||
    ""

  /**
   * `min-w-0` below because this is a GRID CHILD of `lg:grid-cols-[7fr_5fr]`,
   * and a grid item also defaults to `min-width: auto` — it will happily exceed
   * its 7fr track rather than let a wide child scroll. Without it the shipping
   * row's own scroller can shrink and still be overruled from up here.
   */
  return (
    <div className="flex min-w-0 flex-col px-4 py-6 lg:pe-10 lg:py-10 lg:ps-0 gap-y-6">
      {!customer && <SignInPrompt />}

      <CheckoutShippingSection
        cart={cart}
        availableShippingOptions={shippingOptions}
        regions={regions ?? []}
        currentCountry={resolvedCountry}
      />
      <CheckoutInfoRows
        cart={cart}
        customer={customer}
        addresses={addresses}
        availableShippingMethods={shippingOptions}
      />

      {/*
        The promo field is an input too, and it has to come BEFORE payment.
        Below `lg` the columns stack, so leaving it in the summary put it after
        the Place Order button — the buyer could complete the order and only
        then be shown the box for their code. Measured on a phone: the order
        was Contact, Payment, Billing address, THEN "Add Promotion Code(s)".
      */}
      <DiscountCode cart={cart} />

      {/*
        Payment and the billing address are things the buyer FILLS IN, so they
        belong in the column of things to fill in — after Contact, which is the
        last of them. They used to sit in the summary column under the totals
        and the promo field, which made that column half receipt and half form
        and left the buyer moving between the two to finish.

        This also puts the checkout in the order it is actually completed:
        delivery, address, contact, payment.
      */}
      <CheckoutPaymentSection
        cart={cart}
        availablePaymentMethods={paymentMethods ?? []}
      />
    </div>
  )
}