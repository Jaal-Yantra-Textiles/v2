import { Button, FocusModal, Heading, Input, Label, Text } from "@medusajs/ui"
import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"

import { PartnerCurrency } from "../../../hooks/api/partner-currencies"
import {
  PartnerStoreCreatePayload,
  useCreatePartnerStore,
} from "../../../hooks/api/partner-stores"

const buildCountries = (raw: string) =>
  raw
    .split(",")
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean)

export const CreatePartnerStoreModal = ({
  currencies,
  disabled,
}: {
  currencies: PartnerCurrency[]
  disabled?: boolean
}) => {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()

  const defaultCurrency = useMemo(() => {
    return currencies?.[0]?.code ?? "usd"
  }, [currencies])

  const { mutateAsync, isPending } = useCreatePartnerStore()

  const handleSubmit = async (formData: FormData) => {
    const storeName = String(formData.get("store_name") || "").trim()
    const salesChannelName =
      String(formData.get("sales_channel_name") || "").trim() ||
      `${storeName} - Default`
    const regionName = String(formData.get("region_name") || "Primary Region").trim()
    const currencyCode = String(formData.get("currency_code") || "").toLowerCase()
    const countriesRaw = String(formData.get("countries") || "us")
    const locationName = String(formData.get("location_name") || "Main Warehouse").trim()
    const address1 = String(formData.get("address_1") || "").trim()
    const city = String(formData.get("city") || "").trim()
    const postal = String(formData.get("postal_code") || "").trim()
    const countryCode = String(formData.get("country_code") || "US").toUpperCase()

    if (!storeName || !currencyCode || !address1) {
      return
    }

    const payload: PartnerStoreCreatePayload = {
      store: {
        name: storeName,
        supported_currencies: [{ currency_code: currencyCode, is_default: true }],
      },
      sales_channel: {
        name: salesChannelName,
        description: "Default partner sales channel",
      },
      region: {
        name: regionName,
        currency_code: currencyCode,
        countries: buildCountries(countriesRaw),
      },
      location: {
        name: locationName || "Main Warehouse",
        address: {
          address_1: address1,
          city: city || undefined,
          postal_code: postal || undefined,
          country_code: countryCode,
        },
      },
    }

    await mutateAsync(payload)

    setOpen(false)
    navigate("/settings/store")
  }

  return (
    <>
      <Button
        size="small"
        variant="secondary"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        Create store
      </Button>

      <FocusModal open={open} onOpenChange={setOpen}>
        <FocusModal.Content className="max-w-2xl w-full mx-auto my-8">
          <FocusModal.Header>
            <FocusModal.Title asChild>
              <Heading>Create store</Heading>
            </FocusModal.Title>
          </FocusModal.Header>

          <FocusModal.Body className="overflow-auto">
            <div className="p-6">
              <Text size="small" className="text-ui-fg-subtle">
                Provide baseline storefront details. Defaults can be edited later in settings.
              </Text>

              <form
                className="mt-4 space-y-4"
                onSubmit={async (e) => {
                  e.preventDefault()
                  await handleSubmit(new FormData(e.currentTarget))
                }}
              >
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
                    defaultValue={defaultCurrency}
                    required
                  >
                    {(currencies || []).map((currency) => (
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
                  <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" isLoading={isPending} disabled={isPending}>
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
