import { listCartShippingMethods } from "@lib/data/fulfillment"
import { listRegions } from "@lib/data/regions"
import { retrieveCustomerAddresses } from "@lib/data/customer"
import type { HttpTypes } from "@medusajs/types"
import CheckoutShippingSection from "@modules/checkout/components/checkout-shipping-section"
import CheckoutInfoRows from "@modules/checkout/components/checkout-info-rows"
import CheckoutItemList from "@modules/checkout/components/checkout-item-list"
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

  return (
    <div className="flex flex-col px-4 py-6 lg:pe-10 lg:py-10 lg:ps-0 gap-y-6">
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

      <CheckoutItemList cart={cart} />
    </div>
  )
}