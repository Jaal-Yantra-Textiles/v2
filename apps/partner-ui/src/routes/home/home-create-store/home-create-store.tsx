import { zodResolver } from "@hookform/resolvers/zod"
import { Button, Heading, Input, Select, Text, toast } from "@medusajs/ui"
import { useEffect, useMemo } from "react"
import { useForm } from "react-hook-form"
import * as zod from "zod"

import { Form } from "../../../components/common/form"
import { RouteFocusModal, useRouteModal } from "../../../components/modals"
import { KeyboundForm } from "../../../components/utilities/keybound-form"
import { usePartnerCurrencies } from "../../../hooks/api/partner-currencies"
import {
  PartnerStoreCreatePayload,
  useCreatePartnerStore,
} from "../../../hooks/api/partner-stores"
import { useDocumentDirection } from "../../../hooks/use-document-direction"

const CreateStoreSchema = zod.object({
  store_name: zod.string().min(1, "Store name is required"),
  sales_channel_name: zod.string().optional(),
  region_name: zod.string().optional(),
  currency_code: zod.string().min(1, "Currency is required"),
  countries: zod.string().optional(),
  location_name: zod.string().optional(),
  address_1: zod.string().min(1, "Address is required"),
  city: zod.string().optional(),
  postal_code: zod.string().optional(),
  country_code: zod.string().optional(),
})

type CreateStoreValues = zod.infer<typeof CreateStoreSchema>

const buildCountries = (raw: string) =>
  raw
    .split(",")
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean)

export const HomeCreateStore = () => {
  return (
    <RouteFocusModal>
      <HomeCreateStoreForm />
    </RouteFocusModal>
  )
}

const HomeCreateStoreForm = () => {
  const direction = useDocumentDirection()
  const { handleSuccess } = useRouteModal()

  const { currencies } = usePartnerCurrencies({ limit: 100, offset: 0 })

  const defaultCurrency = useMemo(() => {
    return currencies?.[0]?.code ?? "usd"
  }, [currencies])

  const form = useForm<CreateStoreValues>({
    defaultValues: {
      store_name: "",
      sales_channel_name: "",
      region_name: "Primary Region",
      currency_code: "usd",
      countries: "us",
      location_name: "Main Warehouse",
      address_1: "",
      city: "",
      postal_code: "",
      country_code: "US",
    },
    resolver: zodResolver(CreateStoreSchema),
  })

  useEffect(() => {
    const list = Array.isArray(currencies) ? currencies : []
    const current = String(form.getValues("currency_code") || "").toLowerCase()
    const exists = current && list.some((c) => String(c.code).toLowerCase() === current)

    if (!exists) {
      form.setValue("currency_code", defaultCurrency, { shouldDirty: false })
    }
  }, [currencies, defaultCurrency, form])

  const { mutateAsync, isPending } = useCreatePartnerStore()

  const onSubmit = form.handleSubmit(async (values) => {
    const storeName = values.store_name.trim()
    const currencyCode = String(values.currency_code || "").toLowerCase()

    const salesChannelName =
      String(values.sales_channel_name || "").trim() || `${storeName} - Default`

    const regionName = String(values.region_name || "Primary Region").trim()
    const countriesRaw = String(values.countries || "us")

    const locationName = String(values.location_name || "Main Warehouse").trim()

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
          address_1: String(values.address_1 || "").trim(),
          city: String(values.city || "").trim() || undefined,
          postal_code: String(values.postal_code || "").trim() || undefined,
          country_code: String(values.country_code || "US").toUpperCase(),
        },
      },
    }

    await mutateAsync(payload, {
      onSuccess: () => {
        toast.success("Store created")
        handleSuccess("/settings/store")
      },
      onError: (e) => {
        toast.error(e.message)
      },
    })
  })

  return (
    <RouteFocusModal.Form form={form}>
      <KeyboundForm onSubmit={onSubmit} className="flex h-full flex-col overflow-hidden">
        <RouteFocusModal.Header>
          <RouteFocusModal.Title asChild>
            <Heading>Create store</Heading>
          </RouteFocusModal.Title>
          <RouteFocusModal.Description className="sr-only">
            Create store
          </RouteFocusModal.Description>
        </RouteFocusModal.Header>

        <RouteFocusModal.Body className="flex flex-1 flex-col overflow-hidden">
          <div className="flex flex-1 flex-col items-center overflow-y-auto">
            <div className="flex w-full max-w-[720px] flex-col gap-y-8 px-2 py-16">
              <div>
                <Text size="small" className="text-ui-fg-subtle">
                  Provide baseline storefront details. Defaults can be edited later.
                </Text>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Form.Field
                  control={form.control}
                  name="store_name"
                  render={({ field }) => (
                    <Form.Item className="md:col-span-2">
                      <Form.Label>Store name</Form.Label>
                      <Form.Control>
                        <Input {...field} placeholder="Acme Home Store" />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />

                <Form.Field
                  control={form.control}
                  name="sales_channel_name"
                  render={({ field }) => (
                    <Form.Item className="md:col-span-2">
                      <Form.Label>Sales channel name</Form.Label>
                      <Form.Control>
                        <Input {...field} placeholder="Acme Storefront" />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />

                <Form.Field
                  control={form.control}
                  name="currency_code"
                  render={({ field: { onChange, ref, ...field } }) => (
                    <Form.Item>
                      <Form.Label>Default currency</Form.Label>
                      <Form.Control>
                        <Select dir={direction} {...field} onValueChange={onChange}>
                          <Select.Trigger ref={ref}>
                            <Select.Value />
                          </Select.Trigger>
                          <Select.Content>
                            {(currencies || []).map((currency) => (
                              <Select.Item key={currency.code} value={currency.code}>
                                {currency.code.toUpperCase()} • {currency.name || "Currency"}
                              </Select.Item>
                            ))}
                          </Select.Content>
                        </Select>
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />

                <Form.Field
                  control={form.control}
                  name="region_name"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>Region name</Form.Label>
                      <Form.Control>
                        <Input {...field} placeholder="Primary Region" />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />

                <Form.Field
                  control={form.control}
                  name="countries"
                  render={({ field }) => (
                    <Form.Item className="md:col-span-2">
                      <Form.Label>Region countries</Form.Label>
                      <Form.Control>
                        <Input {...field} placeholder="us, ca" />
                      </Form.Control>
                      <Form.ErrorMessage />
                      <Text size="xsmall" className="text-ui-fg-muted mt-1">
                        Comma-separated ISO2 country codes.
                      </Text>
                    </Form.Item>
                  )}
                />

                <Form.Field
                  control={form.control}
                  name="location_name"
                  render={({ field }) => (
                    <Form.Item className="md:col-span-2">
                      <Form.Label>Default location name</Form.Label>
                      <Form.Control>
                        <Input {...field} placeholder="Main Warehouse" />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />

                <Form.Field
                  control={form.control}
                  name="address_1"
                  render={({ field }) => (
                    <Form.Item className="md:col-span-2">
                      <Form.Label>Address line</Form.Label>
                      <Form.Control>
                        <Input {...field} placeholder="123 Main St" />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />

                <Form.Field
                  control={form.control}
                  name="city"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>City</Form.Label>
                      <Form.Control>
                        <Input {...field} placeholder="New York" />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />

                <Form.Field
                  control={form.control}
                  name="postal_code"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>Postal code</Form.Label>
                      <Form.Control>
                        <Input {...field} placeholder="10001" />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />

                <Form.Field
                  control={form.control}
                  name="country_code"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>Country code</Form.Label>
                      <Form.Control>
                        <Input {...field} placeholder="US" maxLength={2} />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />
              </div>

              <div className="flex items-center justify-end gap-x-2">
                <RouteFocusModal.Close asChild>
                  <Button size="small" variant="secondary" type="button">
                    Cancel
                  </Button>
                </RouteFocusModal.Close>
                <Button size="small" type="submit" isLoading={isPending}>
                  Create
                </Button>
              </div>
            </div>
          </div>
        </RouteFocusModal.Body>
      </KeyboundForm>
    </RouteFocusModal.Form>
  )
}
