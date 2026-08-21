import { Heading, Input, Text, Textarea } from "@medusajs/ui"
import { UseFormReturn } from "react-hook-form"
import { useTranslation } from "react-i18next"

import { Form } from "../../../../../components/common/form"
import { Combobox } from "../../../../../components/inputs/combobox"
import { CountrySelect } from "../../../../../components/inputs/country-select"
import { useComboboxData } from "../../../../../hooks/use-combobox-data"
import { sdk } from "../../../../../lib/client"
import { QuoteCreateSchemaType } from "./schema"

type QuoteBuyerFormProps = {
  form: UseFormReturn<QuoteCreateSchemaType>
  currencies: string[]
}

/**
 * Step 1 — who the quote is for, and where it lands.
 *
 * The customer picker writes into `buyer_email` rather than a separate id
 * field. That is not a shortcut: the mint resolves the buyer by email scoped to
 * the store, so an id would be discarded. Picking from the list only guarantees
 * the address matches an existing customer instead of creating a near-duplicate
 * on a typo.
 */
export const QuoteBuyerForm = ({ form, currencies }: QuoteBuyerFormProps) => {
  const { t } = useTranslation()

  const customers = useComboboxData({
    queryFn: (params) =>
      sdk.client.fetch<any>("/partners/customers", {
        method: "GET",
        query: params,
      }),
    queryKey: ["partner-customers-combobox"],
    getOptions: (data) =>
      (data.customers ?? []).map((c: any) => ({
        label: [c.email, [c.first_name, c.last_name].filter(Boolean).join(" ")]
          .filter(Boolean)
          .join(" · "),
        value: c.email,
      })),
  })

  return (
    <div className="flex flex-col gap-y-8">
      <div className="flex flex-col gap-y-1">
        <Heading level="h2">{t("quotes.buyer.header", "Buyer")}</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          {t(
            "quotes.buyer.hint",
            "Pick an existing customer or type a new address — either way the buyer is matched by email, and created if they are new."
          )}
        </Text>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Form.Field
          control={form.control}
          name="buyer_email"
          render={({ field }) => (
            <Form.Item>
              <Form.Label>{t("fields.email", "Buyer email")}</Form.Label>
              <Form.Control>
                <Combobox
                  options={customers.options}
                  fetchNextPage={customers.fetchNextPage}
                  searchValue={customers.searchValue}
                  onSearchValueChange={customers.onSearchValueChange}
                  /**
                   * A brand-new buyer is the common case, so a typed address
                   * that matches nothing must still be selectable — the mint
                   * creates the customer. Without this the picker would only
                   * ever quote people who had already bought.
                   */
                  onCreateOption={(value) => field.onChange(value)}
                  noResultsPlaceholder="Press enter to quote a new buyer"
                  placeholder="buyer@company.com"
                  {...field}
                />
              </Form.Control>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />

        <Form.Field
          control={form.control}
          name="recipient_company"
          render={({ field }) => (
            <Form.Item>
              <Form.Label optional>{t("fields.company", "Company")}</Form.Label>
              <Form.Control>
                <Input {...field} value={field.value ?? ""} />
              </Form.Control>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />

        <Form.Field
          control={form.control}
          name="recipient_name"
          render={({ field }) => (
            <Form.Item>
              <Form.Label optional>
                {t("fields.contactName", "Contact name")}
              </Form.Label>
              <Form.Control>
                <Input {...field} value={field.value ?? ""} />
              </Form.Control>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />

        <Form.Field
          control={form.control}
          name="currency_code"
          render={({ field }) => (
            <Form.Item>
              <Form.Label>{t("fields.currency", "Currency")}</Form.Label>
              <Form.Control>
                <Combobox
                  options={currencies.map((c) => ({
                    label: c.toUpperCase(),
                    value: c,
                  }))}
                  {...field}
                />
              </Form.Control>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />
      </div>

      <div className="flex flex-col gap-y-1">
        <Heading level="h2">
          {t("quotes.destination.header", "Destination")}
        </Heading>
        <Text size="small" className="text-ui-fg-subtle">
          {t(
            "quotes.destination.hint",
            "Freight is quoted once for the whole basket against its summed weight — a multi-line quote ships as one consignment."
          )}
        </Text>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Form.Field
          control={form.control}
          name="destination_country_code"
          render={({ field }) => (
            <Form.Item>
              <Form.Label>{t("fields.country", "Country")}</Form.Label>
              <Form.Control>
                <CountrySelect {...field} />
              </Form.Control>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />

        <Form.Field
          control={form.control}
          name="destination_city"
          render={({ field }) => (
            <Form.Item>
              <Form.Label optional>{t("fields.city", "City")}</Form.Label>
              <Form.Control>
                <Input {...field} value={field.value ?? ""} />
              </Form.Control>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />

        <Form.Field
          control={form.control}
          name="destination_postal_code"
          render={({ field }) => (
            <Form.Item>
              <Form.Label optional>
                {t("fields.postalCode", "Postal code")}
              </Form.Label>
              <Form.Control>
                <Input {...field} value={field.value ?? ""} />
              </Form.Control>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Form.Field
          control={form.control}
          name="ttl_days"
          render={({ field: { onChange, value, ...rest } }) => (
            <Form.Item>
              <Form.Label optional>
                {t("quotes.fields.ttlDays", "Valid for (days)")}
              </Form.Label>
              <Form.Control>
                <Input
                  type="number"
                  min={1}
                  max={365}
                  placeholder="14"
                  value={value ?? ""}
                  onChange={(e) => {
                    const next = e.target.value
                    onChange(next === "" ? undefined : Number(next))
                  }}
                  {...rest}
                />
              </Form.Control>
              <Form.Hint>
                {t(
                  "quotes.fields.ttlHint",
                  "Sets the price list's end date, so the quote expires on its own — nothing has to sweep it."
                )}
              </Form.Hint>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />

        <Form.Field
          control={form.control}
          name="partner_note"
          render={({ field }) => (
            <Form.Item>
              <Form.Label optional>{t("fields.note", "Note to buyer")}</Form.Label>
              <Form.Control>
                <Textarea {...field} value={field.value ?? ""} />
              </Form.Control>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />
      </div>
    </div>
  )
}
