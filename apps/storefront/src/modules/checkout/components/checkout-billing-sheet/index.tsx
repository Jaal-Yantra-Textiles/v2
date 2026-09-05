"use client"

import { useEffect, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { updateCart } from "@lib/data/cart"
import { Button, Checkbox, Text } from "@medusajs/ui"
import type { HttpTypes } from "@medusajs/types"
import Input from "@modules/common/components/input"
import { CheckoutModal } from "@modules/checkout/components/checkout-modal"
import ErrorMessage from "@modules/checkout/components/error-message"

interface CheckoutBillingSheetProps {
  open: boolean
  onClose: () => void
  initialSameAsShipping: boolean
  onSaved?: (sameAsShipping: boolean) => void
  cart: HttpTypes.StoreCart
}

export default function CheckoutBillingSheet({
  open,
  onClose,
  initialSameAsShipping,
  onSaved,
  cart,
}: CheckoutBillingSheetProps) {
  const router = useRouter()
  const shippingAddr = cart.shipping_address
  const billingAddr = cart.billing_address

  const [sameAsShipping, setSameAsShipping] = useState(initialSameAsShipping)
  const [addressFields, setAddressFields] = useState({
    address_1: billingAddr?.address_1 || "",
    postal_code: billingAddr?.postal_code || "",
    city: billingAddr?.city || "",
    province: billingAddr?.province || "",
  })
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setSameAsShipping(initialSameAsShipping)
      setError(null)
    }
  }, [initialSameAsShipping, open])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAddressFields({ ...addressFields, [e.target.name]: e.target.value })
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)
    try {
      if (sameAsShipping) {
        await updateCart({
          billing_address: {
            first_name: shippingAddr?.first_name || "",
            last_name: shippingAddr?.last_name || "",
            address_1: shippingAddr?.address_1 || "",
            company: shippingAddr?.company || "",
            postal_code: shippingAddr?.postal_code || "",
            city: shippingAddr?.city || "",
            country_code: shippingAddr?.country_code || "",
            province: shippingAddr?.province || "",
            phone: shippingAddr?.phone || "",
          },
        })
      } else {
        await updateCart({
          billing_address: {
            first_name: shippingAddr?.first_name || "",
            last_name: shippingAddr?.last_name || "",
            address_1: addressFields.address_1,
            company: shippingAddr?.company || "",
            postal_code: addressFields.postal_code,
            city: addressFields.city,
            country_code: shippingAddr?.country_code || "",
            province: addressFields.province,
            phone: shippingAddr?.phone || "",
          },
        })
      }
      onSaved?.(sameAsShipping)
      onClose()
      router.refresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <CheckoutModal open={open} onClose={onClose} title="Billing address">
      <form onSubmit={handleSubmit} className="flex flex-col">
        <div className="flex flex-col gap-y-3">
          <div className="flex items-center gap-x-2">
            <Checkbox
              checked={sameAsShipping}
              onCheckedChange={(checked) => setSameAsShipping(checked === true)}
            />
            <Text className="text-ui-fg-subtle">Same as shipping address</Text>
          </div>

          {!sameAsShipping && (
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Address"
                name="address_1"
                autoComplete="address-line1"
                value={addressFields.address_1}
                onChange={handleChange}
                required
                data-testid="billing-address-input"
              />
              <Input
                label="Postal code"
                name="postal_code"
                autoComplete="postal-code"
                value={addressFields.postal_code}
                onChange={handleChange}
                required
                data-testid="billing-postal-code-input"
              />
              <Input
                label="City"
                name="city"
                autoComplete="address-level2"
                value={addressFields.city}
                onChange={handleChange}
                required
                data-testid="billing-city-input"
              />
              <Input
                label="State / Province"
                name="province"
                autoComplete="address-level1"
                value={addressFields.province}
                onChange={handleChange}
                data-testid="billing-province-input"
              />
            </div>
          )}
        </div>

        <ErrorMessage error={error} />

        <div className="flex gap-x-2 mt-4">
          <Button
            type="button"
            onClick={onClose}
            variant="secondary"
            size="large"
            className="w-full"
          >
            Close
          </Button>
          <Button
            type="submit"
            disabled={isSubmitting}
            size="large"
            className="w-full"
          >
            {isSubmitting ? "Saving" : "Save"}
          </Button>
        </div>
      </form>
    </CheckoutModal>
  )
}