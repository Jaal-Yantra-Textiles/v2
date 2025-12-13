"use client"

import { Button, FocusModal, Heading, Input, Label, Text } from "@medusajs/ui"
import { useState } from "react"

export type PartnerCurrency = {
  code: string
  name?: string | null
}

export default function CreateStoreModal({
  currencies,
  createStoreAction,
  disabled,
}: {
  currencies: PartnerCurrency[]
  createStoreAction: (formData: FormData) => Promise<void>
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        size="small"
        variant="secondary"
        onClick={() => setOpen(true)}
        disabled={disabled}
      >
        Create store
      </Button>

      <FocusModal open={open} onOpenChange={setOpen}>
        <FocusModal.Content className="z-50 max-w-2xl w-[92vw] sm:w-full mx-auto my-6 sm:my-8">
          <FocusModal.Header>
            <Heading>Create store</Heading>
          </FocusModal.Header>
          <FocusModal.Body className="max-h-[80vh] overflow-y-auto">
            <div className="p-6">
              <Text size="small" className="text-ui-fg-subtle">
                Provide baseline storefront details. Defaults can be edited later in settings.
              </Text>

              <form action={createStoreAction} className="mt-4 space-y-4">
                <div className="space-y-1">
                  <Label htmlFor="store_name">Store name</Label>
                  <Input
                    id="store_name"
                    name="store_name"
                    placeholder="Acme Home Store"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="sales_channel_name">Sales channel name</Label>
                  <Input
                    id="sales_channel_name"
                    name="sales_channel_name"
                    placeholder="Acme Storefront"
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="currency_code">Default currency</Label>
                  <select
                    className="w-full rounded-md border border-ui-border-base bg-ui-bg-base px-3 py-2 text-sm"
                    name="currency_code"
                    defaultValue={currencies[0]?.code ?? "usd"}
                    required
                  >
                    {currencies.map((currency) => (
                      <option key={currency.code} value={currency.code}>
                        {currency.code.toUpperCase()} • {currency.name || "Currency"}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="region_name">Region name</Label>
                  <Input id="region_name" name="region_name" placeholder="Primary Region" />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="countries">Region countries</Label>
                  <Input id="countries" name="countries" placeholder="us, ca" defaultValue="us" />
                  <Text size="xsmall" className="text-ui-fg-muted">
                    Comma-separated ISO2 country codes.
                  </Text>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="location_name">Default location name</Label>
                  <Input id="location_name" name="location_name" placeholder="Main Warehouse" />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="address_1">Address line</Label>
                  <Input id="address_1" name="address_1" placeholder="123 Main St" required />
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="city">City</Label>
                    <Input id="city" name="city" placeholder="New York" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="postal_code">Postal code</Label>
                    <Input id="postal_code" name="postal_code" placeholder="10001" />
                  </div>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="country_code">Country code</Label>
                  <Input
                    id="country_code"
                    name="country_code"
                    placeholder="US"
                    defaultValue="US"
                    maxLength={2}
                  />
                </div>

                <div className="flex items-center justify-end gap-x-2 pt-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    onClick={() => {
                      // close modal immediately; navigation will happen via server action redirect
                      setOpen(false)
                    }}
                  >
                    Create store
                  </Button>
                </div>
              </form>
            </div>
          </FocusModal.Body>
        </FocusModal.Content>
      </FocusModal>
    </>
  )
}
