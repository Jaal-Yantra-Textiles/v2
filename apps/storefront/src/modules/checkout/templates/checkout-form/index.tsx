import { listCartShippingMethods } from "@lib/data/fulfillment"
import { listRegions } from "@lib/data/regions"
import { retrieveCustomerAddresses } from "@lib/data/customer"
import type { HttpTypes } from "@medusajs/types"
import CheckoutShippingSection from "@modules/checkout/components/checkout-shipping-section"
import CheckoutInfoRows from "@modules/checkout/components/checkout-info-rows"
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

  const [shippingOptions, regions, addresses] = await Promise.all([
    listCartShippingMethods(cart.id),
    listRegions(),
    retrieveCustomerAddresses(),
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

    </div>
  )
}