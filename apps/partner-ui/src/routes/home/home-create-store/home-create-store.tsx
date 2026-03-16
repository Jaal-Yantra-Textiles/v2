import { zodResolver } from "@hookform/resolvers/zod"
import { Button, Heading, Input, Select, Text, Textarea, toast } from "@medusajs/ui"
import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { z as zod } from "@medusajs/framework/zod"

import { Form } from "../../../components/common/form"
import { CountrySelect } from "../../../components/inputs/country-select"
import { RouteFocusModal, useRouteModal } from "../../../components/modals"
import { KeyboundForm } from "../../../components/utilities/keybound-form"
import { usePartnerCurrencies } from "../../../hooks/api/partner-currencies"
import {
  PartnerStoreCreatePayload,
  useCreatePartnerStore,
} from "../../../hooks/api/partner-stores"
import { useDocumentDirection } from "../../../hooks/use-document-direction"
import { countries as countryData } from "../../../lib/data/countries"
import { extractErrorMessage } from "../../../lib/extract-error-message"

const CreateStoreSchema = zod.object({
  store_name: zod.string().min(1, "Store name is required"),
  store_description: zod.string().optional(),
  currency_code: zod.string().min(1, "Currency is required"),
  country_code: zod.string().min(2, "Country is required"),
  address_1: zod.string().min(1, "Address is required"),
  city: zod.string().optional(),
  province: zod.string().optional(),
  postal_code: zod.string().optional(),
})

type CreateStoreValues = zod.infer<typeof CreateStoreSchema>

const COUNTRY_CURRENCY_MAP: Record<string, string> = {
  us: "usd", gb: "gbp", in: "inr", au: "aud", ca: "cad",
  de: "eur", fr: "eur", it: "eur", es: "eur", nl: "eur",
  jp: "jpy", cn: "cny", kr: "krw", br: "brl", mx: "mxn",
  ae: "aed", sg: "sgd", nz: "nzd", za: "zar", se: "sek",
  no: "nok", dk: "dkk", ch: "chf",
}

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

  const form = useForm<CreateStoreValues>({
    defaultValues: {
      store_name: "",
      store_description: "",
      currency_code: "",
      country_code: "",
      address_1: "",
      city: "",
      province: "",
      postal_code: "",
    },
    resolver: zodResolver(CreateStoreSchema),
  })

  const selectedCountry = form.watch("country_code")

  // Auto-set currency when country changes
  useEffect(() => {
    if (!selectedCountry) return
    const suggested = COUNTRY_CURRENCY_MAP[selectedCountry.toLowerCase()]
    if (suggested && (currencies || []).some((c) => c.code.toLowerCase() === suggested)) {
      form.setValue("currency_code", suggested, { shouldDirty: true })
    }
  }, [selectedCountry, currencies, form])

  const { mutateAsync, isPending } = useCreatePartnerStore()

  const onSubmit = form.handleSubmit(async (values) => {
    const storeName = values.store_name.trim()
    const currencyCode = values.currency_code.toLowerCase()
    const countryCode = values.country_code.toLowerCase()

    const countryInfo = countryData.find(
      (c) => c.iso_2.toLowerCase() === countryCode
    )
    const regionName = countryInfo
      ? `${countryInfo.display_name} Region`
      : "Primary Region"

    const payload: PartnerStoreCreatePayload = {
      store: {
        name: storeName,
        supported_currencies: [{ currency_code: currencyCode, is_default: true }],
        metadata: values.store_description
          ? { description: values.store_description }
          : undefined,
      },
      sales_channel: {
        name: `${storeName} - Online Store`,
        description: `Default sales channel for ${storeName}`,
      },
      region: {
        name: regionName,
        currency_code: currencyCode,
        countries: [countryCode],
      },
      location: {
        name: `${storeName} Warehouse`,
        address: {
          address_1: values.address_1.trim(),
          city: values.city?.trim() || undefined,
          province: values.province?.trim() || undefined,
          postal_code: values.postal_code?.trim() || undefined,
          country_code: countryCode.toUpperCase(),
        },
      },
    }

    await mutateAsync(payload, {
      onSuccess: () => {
        toast.success("Store created successfully")
        handleSuccess("/settings/store")
      },
      onError: (e) => {
        toast.error(extractErrorMessage(e))
      },
    })
  })

  return (
    <RouteFocusModal.Form form={form}>
      <KeyboundForm onSubmit={onSubmit} className="flex h-full flex-col overflow-hidden">
        <RouteFocusModal.Header>
          <RouteFocusModal.Title asChild>
            <Heading>Create Your Store</Heading>
          </RouteFocusModal.Title>
          <RouteFocusModal.Description className="sr-only">
            Set up your store
          </RouteFocusModal.Description>
        </RouteFocusModal.Header>

        <RouteFocusModal.Body className="flex flex-1 flex-col overflow-hidden">
          <div className="flex flex-1 flex-col items-center overflow-y-auto">
            <div className="flex w-full max-w-[720px] flex-col gap-y-8 px-2 py-16">
              {/* Store Details */}
              <div>
                <Heading level="h2" className="mb-1">Store Details</Heading>
                <Text size="small" className="text-ui-fg-subtle">
                  Basic information about your store. You can update these later.
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
                        <Input {...field} placeholder="My Awesome Store" autoFocus />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />

                <Form.Field
                  control={form.control}
                  name="store_description"
                  render={({ field }) => (
                    <Form.Item className="md:col-span-2">
                      <Form.Label optional>Description</Form.Label>
                      <Form.Control>
                        <Textarea {...field} placeholder="Tell customers what your store is about..." rows={2} />
                      </Form.Control>
                    </Form.Item>
                  )}
                />

                <Form.Field
                  control={form.control}
                  name="country_code"
                  render={({ field: { onChange, ref, ...field } }) => (
                    <Form.Item>
                      <Form.Label>Country</Form.Label>
                      <Form.Control>
                        <CountrySelect {...field} ref={ref} onChange={onChange} placeholder="Select your country" />
                      </Form.Control>
                      <Form.ErrorMessage />
                      <Form.Hint>Where your business operates from</Form.Hint>
                    </Form.Item>
                  )}
                />

                <Form.Field
                  control={form.control}
                  name="currency_code"
                  render={({ field: { onChange, ref, ...field } }) => (
                    <Form.Item>
                      <Form.Label>Currency</Form.Label>
                      <Form.Control>
                        <Select dir={direction} {...field} onValueChange={onChange}>
                          <Select.Trigger ref={ref}>
                            <Select.Value placeholder="Select currency" />
                          </Select.Trigger>
                          <Select.Content>
                            {(currencies || []).map((currency) => (
                              <Select.Item key={currency.code} value={currency.code}>
                                {currency.code.toUpperCase()} — {currency.name || currency.code}
                              </Select.Item>
                            ))}
                          </Select.Content>
                        </Select>
                      </Form.Control>
                      <Form.ErrorMessage />
                      <Form.Hint>Auto-suggested based on country</Form.Hint>
                    </Form.Item>
                  )}
                />
              </div>

              {/* Location */}
              <div>
                <Heading level="h2" className="mb-1">Warehouse / Pickup Location</Heading>
                <Text size="small" className="text-ui-fg-subtle">
                  Where you ship orders from. You can add more locations later.
                </Text>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Form.Field
                  control={form.control}
                  name="address_1"
                  render={({ field }) => (
                    <Form.Item className="md:col-span-2">
                      <Form.Label>Street address</Form.Label>
                      <Form.Control>
                        <Input {...field} placeholder="123 Main St, Suite 4" />
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
                      <Form.Label optional>City</Form.Label>
                      <Form.Control>
                        <Input {...field} placeholder="Mumbai" />
                      </Form.Control>
                    </Form.Item>
                  )}
                />

                <Form.Field
                  control={form.control}
                  name="province"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label optional>State / Province</Form.Label>
                      <Form.Control>
                        <Input {...field} placeholder="Maharashtra" />
                      </Form.Control>
                    </Form.Item>
                  )}
                />

                <Form.Field
                  control={form.control}
                  name="postal_code"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label optional>Postal code</Form.Label>
                      <Form.Control>
                        <Input {...field} placeholder="400001" />
                      </Form.Control>
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
                  Create Store
                </Button>
              </div>
            </div>
          </div>
        </RouteFocusModal.Body>
      </KeyboundForm>
    </RouteFocusModal.Form>
  )
}
