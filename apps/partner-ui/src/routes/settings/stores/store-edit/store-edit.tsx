import { zodResolver } from "@hookform/resolvers/zod"
import { Button, Heading, Input, Select, toast } from "@medusajs/ui"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { z } from "zod"

import { Form } from "../../../../components/common/form"
import { Combobox } from "../../../../components/inputs/combobox"
import { RouteDrawer, useRouteModal } from "../../../../components/modals"
import { KeyboundForm } from "../../../../components/utilities/keybound-form"
import { usePartnerStores, useUpdatePartnerStore } from "../../../../hooks/api/partner-stores"
import { useStore } from "../../../../hooks/api/store"
import { useComboboxData } from "../../../../hooks/use-combobox-data"
import { sdk } from "../../../../lib/client"

const EditStoreSchema = z.object({
  name: z.string().min(1),
  default_currency_code: z.string().optional(),
  default_region_id: z.string().optional(),
  default_sales_channel_id: z.string().optional(),
  default_location_id: z.string().optional(),
})

export const StoreEdit = () => {
  const { store, isPending: isLoading } = useStore()

  if (isLoading || !store) {
    return (
      <RouteDrawer>
        <RouteDrawer.Header>
          <Heading>Edit Store</Heading>
        </RouteDrawer.Header>
        <RouteDrawer.Body>
          <div className="h-32" />
        </RouteDrawer.Body>
      </RouteDrawer>
    )
  }

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <Heading>Edit Store</Heading>
      </RouteDrawer.Header>
      <StoreEditForm store={store} />
    </RouteDrawer>
  )
}

const StoreEditForm = ({ store }: { store: any }) => {
  const { t } = useTranslation()
  const { handleSuccess } = useRouteModal()

  const form = useForm<z.infer<typeof EditStoreSchema>>({
    defaultValues: {
      name: store.name || "",
      default_currency_code:
        store.supported_currencies?.find((c: any) => c.is_default)?.currency_code ||
        undefined,
      default_region_id: store.default_region_id || undefined,
      default_sales_channel_id: store.default_sales_channel_id || undefined,
      default_location_id: store.default_location_id || undefined,
    },
    resolver: zodResolver(EditStoreSchema),
  })

  const { mutateAsync: updateStore, isPending: isSaving } = useUpdatePartnerStore(store.id)

  const regionsCombobox = useComboboxData({
    queryKey: ["regions", "default_region_id"],
    queryFn: (params) =>
      sdk.client.fetch<any>(`/partners/stores/${store.id}/regions`, {
        method: "GET",
        query: params,
      }),
    defaultValue: store.default_region_id || undefined,
    getOptions: (data) =>
      data.regions.map((r: any) => ({ label: r.name, value: r.id })),
  })

  const salesChannelsCombobox = useComboboxData({
    queryKey: ["sales_channels", "default_sales_channel_id"],
    queryFn: (params) =>
      sdk.client.fetch<any>(`/partners/stores/${store.id}/sales-channels`, {
        method: "GET",
        query: params,
      }),
    defaultValue: store.default_sales_channel_id || undefined,
    getOptions: (data) =>
      data.sales_channels.map((sc: any) => ({ label: sc.name, value: sc.id })),
  })

  const locationsCombobox = useComboboxData({
    queryKey: ["stock_locations", "default_location_id"],
    queryFn: (params) =>
      sdk.client.fetch<any>(`/partners/stores/${store.id}/locations`, {
        method: "GET",
        query: params,
      }),
    defaultValue: store.default_location_id || undefined,
    getOptions: (data) =>
      data.stock_locations.map((l: any) => ({ label: l.name, value: l.id })),
  })

  const handleSubmit = form.handleSubmit(async (values) => {
    const { default_currency_code, ...rest } = values

    const payload: Record<string, any> = { ...rest }

    // Update supported_currencies with the new default
    if (store.supported_currencies?.length) {
      payload.supported_currencies = store.supported_currencies.map((c: any) => ({
        currency_code: c.currency_code,
        is_default: c.currency_code === default_currency_code,
      }))
    }

    await updateStore(payload, {
      onSuccess: () => {
        toast.success(t("store.toast.update"))
        handleSuccess()
      },
      onError: (err) => {
        toast.error(err?.message || "Failed to update store")
      },
    })
  })

  return (
    <RouteDrawer.Form form={form}>
      <KeyboundForm
        onSubmit={handleSubmit}
        className="flex h-full flex-col overflow-hidden"
      >
        <RouteDrawer.Body className="overflow-y-auto">
          <div className="flex flex-col gap-y-8">
            <Form.Field
              control={form.control}
              name="name"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label>{t("fields.name")}</Form.Label>
                  <Form.Control>
                    <Input placeholder="My Store" {...field} />
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />
            {store.supported_currencies?.length > 0 && (
              <Form.Field
                control={form.control}
                name="default_currency_code"
                render={({ field: { onChange, ...field } }) => (
                  <Form.Item>
                    <Form.Label>{t("store.defaultCurrency")}</Form.Label>
                    <Form.Control>
                      <Select {...field} onValueChange={onChange}>
                        <Select.Trigger ref={field.ref}>
                          <Select.Value />
                        </Select.Trigger>
                        <Select.Content>
                          {store.supported_currencies.map((currency: any) => (
                            <Select.Item
                              key={currency.currency_code}
                              value={currency.currency_code}
                            >
                              {currency.currency_code.toUpperCase()}
                            </Select.Item>
                          ))}
                        </Select.Content>
                      </Select>
                    </Form.Control>
                  </Form.Item>
                )}
              />
            )}
            <Form.Field
              control={form.control}
              name="default_region_id"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label>{t("store.defaultRegion")}</Form.Label>
                  <Form.Control>
                    <Combobox
                      {...field}
                      options={regionsCombobox.options}
                      searchValue={regionsCombobox.searchValue}
                      onSearchValueChange={regionsCombobox.onSearchValueChange}
                      disabled={regionsCombobox.disabled}
                    />
                  </Form.Control>
                </Form.Item>
              )}
            />
            <Form.Field
              control={form.control}
              name="default_sales_channel_id"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label>{t("store.defaultSalesChannel")}</Form.Label>
                  <Form.Control>
                    <Combobox
                      {...field}
                      options={salesChannelsCombobox.options}
                      searchValue={salesChannelsCombobox.searchValue}
                      onSearchValueChange={salesChannelsCombobox.onSearchValueChange}
                      disabled={salesChannelsCombobox.disabled}
                    />
                  </Form.Control>
                </Form.Item>
              )}
            />
            <Form.Field
              control={form.control}
              name="default_location_id"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label>{t("store.defaultLocation")}</Form.Label>
                  <Form.Control>
                    <Combobox
                      {...field}
                      options={locationsCombobox.options}
                      searchValue={locationsCombobox.searchValue}
                      onSearchValueChange={locationsCombobox.onSearchValueChange}
                      disabled={locationsCombobox.disabled}
                    />
                  </Form.Control>
                </Form.Item>
              )}
            />
          </div>
        </RouteDrawer.Body>
        <RouteDrawer.Footer>
          <div className="flex items-center justify-end gap-x-2">
            <RouteDrawer.Close asChild>
              <Button variant="secondary" size="small">
                {t("actions.cancel")}
              </Button>
            </RouteDrawer.Close>
            <Button type="submit" size="small" isLoading={isSaving}>
              {t("actions.save")}
            </Button>
          </div>
        </RouteDrawer.Footer>
      </KeyboundForm>
    </RouteDrawer.Form>
  )
}
