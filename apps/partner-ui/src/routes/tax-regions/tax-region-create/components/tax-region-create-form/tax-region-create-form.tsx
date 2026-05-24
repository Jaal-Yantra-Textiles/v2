import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { z } from "@medusajs/framework/zod"

import { InformationCircleSolid } from "@medusajs/icons"
import { Button, Heading, Input, Text, toast, Tooltip } from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import { Form } from "../../../../../components/common/form"
import { SwitchBox } from "../../../../../components/common/switch-box"
import { CountrySelect } from "../../../../../components/inputs/country-select"
import { PercentageInput } from "../../../../../components/inputs/percentage-input"
import {
  RouteFocusModal,
  useRouteModal,
} from "../../../../../components/modals"
import { KeyboundForm } from "../../../../../components/utilities/keybound-form"
import { useCreateTaxRegion } from "../../../../../hooks/api"
import { useComboboxData } from "../../../../../hooks/use-combobox-data"
import { Combobox } from "../../../../../components/inputs/combobox"
import { formatProvider } from "../../../../../lib/format-provider"
import { sdk } from "../../../../../lib/client"
import { i18n } from "../../../../../components/utilities/i18n"

type TaxRegionCreateFormProps = {
  parentId?: string
}

const TaxRegionCreateSchema = z
  .object({
    name: z.string().optional(),
    code: z.string().optional(),
    rate: z.object({
      float: z.number().optional(),
      value: z.string().optional(),
    }),
    is_combinable: z.boolean().optional(),
    country_code: z.string(),
    province_code: z.string().optional(),
    provider_id: z.string(),
  })
  .superRefine(({ provider_id, country_code }, ctx) => {
    if (!provider_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: i18n.t("taxRegions.create.errors.missingProvider"),
        path: ["provider_id"],
      })
    }

    if (!country_code) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: i18n.t("taxRegions.create.errors.missingCountry"),
        path: ["country_code"],
      })
    }
  })

export const TaxRegionCreateForm = ({ parentId }: TaxRegionCreateFormProps) => {
  const { t } = useTranslation()
  const { handleSuccess } = useRouteModal()

  const taxProviders = useComboboxData({
    queryKey: ["tax_providers"],
    queryFn: (params) => sdk.client.fetch<any>("/partners/tax-providers", { method: "GET", query: params }),
    getOptions: (data) =>
      data.tax_providers.map((provider) => ({
        label: formatProvider(provider.id),
        value: provider.id,
      })),
  })

  const form = useForm<z.infer<typeof TaxRegionCreateSchema>>({
    defaultValues: {
      name: "",
      rate: {
        value: "",
      },
      code: "",
      is_combinable: false,
      country_code: "",
      province_code: "",
      provider_id: "",
    },
    resolver: zodResolver(TaxRegionCreateSchema),
  })

  const { mutateAsync, isPending } = useCreateTaxRegion()

  const handleSubmit = form.handleSubmit(async (values) => {
    const defaultRate = values.name
      ? {
          name: values.name,
          rate:
            values.rate?.value === ""
              ? undefined
              : parseFloat(values.rate.value!),
          code: values.code,
          is_combinable: values.is_combinable,
        }
      : undefined

    await mutateAsync(
      {
        country_code: values.country_code,
        province_code: values.province_code || undefined,
        parent_id: parentId,
        default_tax_rate: defaultRate,
        provider_id: values.provider_id,
      },
      {
        onSuccess: ({ tax_region }) => {
          toast.success(t("taxRegions.create.successToast"))
          handleSuccess(`../${tax_region.id}`)
        },
        onError: (error) => {
          toast.error(error.message)
        },
      }
    )
  })

  return (
    <RouteFocusModal.Form form={form}>
      <KeyboundForm
        onSubmit={handleSubmit}
        className="flex h-full flex-col overflow-hidden"
      >
        <RouteFocusModal.Header />
        <RouteFocusModal.Body className="flex flex-1 flex-col overflow-hidden">
          <div className="flex flex-1 flex-col items-center overflow-y-auto">
            <div className="flex w-full max-w-[720px] flex-col gap-y-8 px-2 py-16">
              <div>
                <Heading className="capitalize">
                  {t("taxRegions.create.header")}
                </Heading>
                <Text size="small" className="text-ui-fg-subtle">
                  {t("taxRegions.create.hint")}
                </Text>
              </div>
              <div className="flex flex-col gap-y-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Form.Field
                    control={form.control}
                    name="country_code"
                    render={({ field }) => {
                      return (
                        <Form.Item>
                          <Form.Label>{t("fields.country")}</Form.Label>
                          <Form.Control>
                            <CountrySelect {...field} />
                          </Form.Control>
                          <Form.ErrorMessage />
                        </Form.Item>
                      )
                    }}
                  />
                  <Form.Field
                    control={form.control}
                    name="provider_id"
                    render={({ field }) => (
                      <Form.Item>
                        <Form.Label>
                          {t("taxRegions.fields.taxProvider")}
                        </Form.Label>
                        <Form.Control>
                          <Combobox
                            {...field}
                            options={taxProviders.options}
                            searchValue={taxProviders.searchValue}
                            onSearchValueChange={
                              taxProviders.onSearchValueChange
                            }
                            fetchNextPage={taxProviders.fetchNextPage}
                          />
                        </Form.Control>
                        <Form.ErrorMessage />
                      </Form.Item>
                    )}
                  />
                </div>
                {/*
                  Province / sub-region code — optional, lets the partner
                  create a province-level tax region directly (e.g.
                  country=us, province=ca for California). Admin's
                  AdminCreateTaxRegion accepts the same field. Province
                  tax regions still inherit their provider from the parent
                  country tax region; admin's flow handles that via
                  parent_id. For now the field is just collected here —
                  the backend handler passes it through to
                  createTaxRegionsWorkflow.
                */}
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Form.Field
                    control={form.control}
                    name="province_code"
                    render={({ field }) => {
                      return (
                        <Form.Item>
                          <Form.Label optional>
                            {t("fields.province") || "Province code"}
                          </Form.Label>
                          <Form.Control>
                            <Input
                              {...field}
                              placeholder="e.g. ca, on, mh"
                            />
                          </Form.Control>
                          <Form.ErrorMessage />
                        </Form.Item>
                      )
                    }}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-x-1">
                  <Heading level="h2" className="!txt-compact-small-plus">
                    {t("taxRegions.fields.defaultTaxRate.label")}
                  </Heading>
                  <Text
                    size="small"
                    leading="compact"
                    className="text-ui-fg-muted"
                  >
                    ({t("fields.optional")})
                  </Text>
                  <Tooltip
                    content={t("taxRegions.fields.defaultTaxRate.tooltip")}
                  >
                    <InformationCircleSolid className="text-ui-fg-muted" />
                  </Tooltip>
                </div>
                <div className="flex flex-col gap-y-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <Form.Field
                      control={form.control}
                      name="name"
                      render={({ field }) => {
                        return (
                          <Form.Item>
                            <Form.Label>{t("fields.name")}</Form.Label>
                            <Form.Control>
                              <Input {...field} />
                            </Form.Control>
                            <Form.ErrorMessage />
                          </Form.Item>
                        )
                      }}
                    />
                    <Form.Field
                      control={form.control}
                      name="rate"
                      render={({ field: { value, onChange, ...field } }) => {
                        return (
                          <Form.Item>
                            <Form.Label>
                              {t("taxRegions.fields.taxRate")}
                            </Form.Label>
                            <Form.Control>
                              <PercentageInput
                                {...field}
                                value={value?.value}
                                decimalsLimit={4}
                                onValueChange={(value, _name, values) =>
                                  onChange({
                                    value: value,
                                    float: values?.float,
                                  })
                                }
                              />
                            </Form.Control>
                            <Form.ErrorMessage />
                          </Form.Item>
                        )
                      }}
                    />
                    <Form.Field
                      control={form.control}
                      name="code"
                      render={({ field }) => {
                        return (
                          <Form.Item>
                            <Form.Label>
                              {t("taxRegions.fields.taxCode")}
                            </Form.Label>
                            <Form.Control>
                              <Input {...field} />
                            </Form.Control>
                            <Form.ErrorMessage />
                          </Form.Item>
                        )
                      }}
                    />
                  </div>
                  {/*
                    Combinable — matches the admin tax-rate form and the
                    sibling tax-region-tax-rate-create form. When true,
                    this default rate stacks with other applicable rates
                    instead of taking precedence. Same SwitchBox component
                    used elsewhere for parity look-and-feel.
                  */}
                  <SwitchBox
                    control={form.control}
                    name="is_combinable"
                    label={t("taxRegions.fields.isCombinable.label") || "Combinable"}
                    description={
                      t("taxRegions.fields.isCombinable.hint") ||
                      "When enabled, this rate stacks with other applicable rates instead of overriding them."
                    }
                  />
                </div>
              </div>
            </div>
          </div>
        </RouteFocusModal.Body>
        <RouteFocusModal.Footer>
          <div className="flex items-center justify-end gap-x-2">
            <RouteFocusModal.Close asChild>
              <Button size="small" variant="secondary">
                {t("actions.cancel")}
              </Button>
            </RouteFocusModal.Close>
            <Button size="small" type="submit" isLoading={isPending}>
              {t("actions.save")}
            </Button>
          </div>
        </RouteFocusModal.Footer>
      </KeyboundForm>
    </RouteFocusModal.Form>
  )
}
