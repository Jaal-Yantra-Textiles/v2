import { Heading, Input, Switch, Text, Textarea } from "@medusajs/ui"
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
  /** ISO-2 of the store's dispatch country, or null when unknown (#1447). */
  originCountryCode?: string | null
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
export const QuoteBuyerForm = ({
  form,
  currencies,
  originCountryCode,
}: QuoteBuyerFormProps) => {
  const { t } = useTranslation()

  const destinationCountry = form.watch("destination_country_code")
  /**
   * DDP only means something across a border (#1447). On a domestic lane there
   * is no import duty and no import tax to prepay, and the charges would be
   * ADDED to the buyer's total — billing them for a customs event that never
   * happens. The mint refuses it as well; hiding a field is a UI convention and
   * the API is reachable without one.
   *
   * 🔴 Unknown origin keeps the section visible. Asking about duty on a
   * domestic quote costs a moment; hiding it on a real export costs the buyer a
   * customs bill they were told would not come.
   */
  const origin = String(originCountryCode || "").toUpperCase()
  const destination = String(destinationCountry || "").toUpperCase()
  const isDomesticLane =
    /^[A-Z]{2}$/.test(origin) &&
    /^[A-Z]{2}$/.test(destination) &&
    origin === destination

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

        {/*
          The buyer's registration, for the document header (#1486).

          🔑 Labelled "as provided" and nothing more. Nothing checks it against
          VIES or the GST portal, and a field that reads as verified invites a
          reverse-charge assumption nobody is entitled to make.
        */}
        <div className="grid grid-cols-2 gap-x-3">
          <Form.Field
            control={form.control}
            name="buyer_tax_id"
            render={({ field }) => (
              <Form.Item>
                <Form.Label optional>
                  {t("fields.buyerTaxId", "VAT / tax number")}
                </Form.Label>
                <Form.Control>
                  <Input
                    {...field}
                    value={field.value ?? ""}
                    placeholder="DE123456789"
                  />
                </Form.Control>
                <Form.Hint>
                  {t(
                    "quotes.create.buyer.taxIdHint",
                    "As the buyer gave it. Shown on the quote; it does not change the price or the tax."
                  )}
                </Form.Hint>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />

          <Form.Field
            control={form.control}
            name="buyer_tax_id_type"
            render={({ field }) => (
              <Form.Item>
                <Form.Label optional>
                  {t("fields.buyerTaxIdType", "Scheme")}
                </Form.Label>
                <Form.Control>
                  <Input
                    {...field}
                    value={field.value ?? ""}
                    placeholder="eu_vat"
                  />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
        </div>

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
          name="freight_override_amount"
          render={({ field: { onChange, value, ...rest } }) => (
            <Form.Item>
              <Form.Label optional>
                {t("quotes.fields.freightOverride", "Freight, quoted by hand")}
              </Form.Label>
              <Form.Control>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="250"
                  value={value ?? ""}
                  onChange={(e) => {
                    const next = e.target.value
                    onChange(next === "" ? undefined : Number(next))
                  }}
                  {...rest}
                />
              </Form.Control>
              {/**
               * 🔴 The currency is NAMED, not implied.
               *
               * This field is taken as-is, while the per-line
               * `override_unit_amount` in the next step is in the STORE's
               * currency and gets FX-converted. Two "type a price by hand"
               * fields meaning two different currencies is a trap, and the
               * realistic mistake is expensive: a partner on an INR store
               * looking up a rupee freight quote for a EUR lane types 4000 and
               * offers €4,000 of shipping.
               *
               * Nothing downstream catches it — readiness stamps the override
               * with the quote currency BY CONSTRUCTION, so the
               * currency-mismatch guard cannot fire on it. Naming the code is
               * the whole defence.
               */}
              <Form.Hint>
                {t(
                  "quotes.fields.freightOverrideHint",
                  "In {{currency}} — the quote's currency, not your store's. Use it when no carrier will rate the lane, or when the stored tier is wrong for this weight. Leave blank to use the rate.",
                  {
                    currency: String(
                      form.watch("currency_code") || "the quote's currency"
                    ).toUpperCase(),
                  }
                )}
              </Form.Hint>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />

        <Form.Field
          control={form.control}
          name="freight_basis"
          render={({ field }) => (
            <Form.Item>
              <Form.Label optional>
                {t("quotes.fields.freightBasis", "Where that figure came from")}
              </Form.Label>
              <Form.Control>
                <Input
                  placeholder="DHL rate card 12 Aug, 22 kg to DE"
                  {...field}
                  value={field.value ?? ""}
                />
              </Form.Control>
              <Form.Hint>
                {t(
                  "quotes.fields.freightBasisHint",
                  "Evidence, not decoration: whoever meets the forwarder's invoice is not who typed the number."
                )}
              </Form.Hint>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />

        <Form.Field
          control={form.control}
          name="deposit_pct"
          render={({ field: { onChange, value, ...rest } }) => (
            <Form.Item>
              <Form.Label optional>
                {t("quotes.fields.depositPct", "Deposit (%)")}
              </Form.Label>
              <Form.Control>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  placeholder="30"
                  value={value ?? ""}
                  onChange={(e) => {
                    const next = e.target.value
                    // 🔑 Only an EMPTY string is "unset". `Number("0")` is 0 and
                    // must survive as 0 — a partner taking nothing up front
                    // means it, and turning that into "unset" would hand the
                    // buyer a 30% demand nobody agreed to.
                    onChange(next === "" ? undefined : Number(next))
                  }}
                  {...rest}
                />
              </Form.Control>
              <Form.Hint>
                {t(
                  "quotes.fields.depositHint",
                  "What the buyer pays up front when they accept; the rest is invoiced when the goods are ready. Leave blank for the default 30%."
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

      {isDomesticLane ? (
        <Text size="small" className="text-ui-fg-muted">
          {t("quotes.duty.domestic", {
            defaultValue:
              "This quote ships within {{country}}, so there is no import duty or tax to prepay.",
            country: destination,
          })}
        </Text>
      ) : null}

      <div className={isDomesticLane ? "hidden" : "flex flex-col gap-y-1"}>
        <Heading level="h2">
          {t("quotes.duty.header", "Import duty (DDP)")}
        </Heading>
        <Text size="small" className="text-ui-fg-subtle">
          {t(
            "quotes.duty.hint",
            "Only for an export. Turn this on and the buyer is told there is nothing further to pay on delivery — which means we pay their customs bill, and someone has to arrange that clearance by hand until a carrier can."
          )}
        </Text>
      </div>

      {isDomesticLane ? null : (
      <Form.Field
        control={form.control}
        name="duties_prepaid"
        render={({ field: { value, onChange, ...rest } }) => (
          <Form.Item>
            <div className="flex items-start justify-between gap-4 rounded-lg border border-ui-border-base p-4">
              <div className="flex flex-col gap-y-1">
                <Form.Label>
                  {t("quotes.fields.dutiesPrepaid", "We pay the import duty")}
                </Form.Label>
                <Form.Hint>
                  {t(
                    "quotes.fields.dutiesPrepaidHint",
                    "Leave off and the buyer is the importer of record — duty and import VAT are theirs, and the quote says so."
                  )}
                </Form.Hint>
              </div>
              <Form.Control>
                <Switch
                  checked={Boolean(value)}
                  onCheckedChange={(checked) => {
                    onChange(checked)
                    if (!checked) {
                      /**
                       * 🔴 Clear the pair when the undertaking is withdrawn. A
                       * duty amount left behind on a non-DDP quote is refused
                       * by the backend, and it would be worse if it were not:
                       * it would be added to a total whose buyer was told duty
                       * is theirs to pay on arrival.
                       */
                      form.setValue("duty_rate_percent", null)
                      form.setValue("import_tax_rate_percent", null)
                      form.setValue("ddp_fee_total", null)
                      form.setValue("duty_basis", null)
                      form.clearErrors([
                        "duty_rate_percent",
                        "import_tax_rate_percent",
                        "ddp_fee_total",
                        "duty_basis",
                      ])
                    }
                  }}
                  {...rest}
                />
              </Form.Control>
            </div>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />

      )}

      {!isDomesticLane && form.watch("duties_prepaid") ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Form.Field
            control={form.control}
            name="duty_rate_percent"
            render={({ field: { onChange, value, ...rest } }) => (
              <Form.Item>
                <Form.Label>
                  {t("quotes.fields.dutyRate", "Duty rate %")}
                </Form.Label>
                <Form.Control>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    placeholder="8"
                    value={value ?? ""}
                    onChange={(e) => {
                      const next = e.target.value
                      onChange(next === "" ? null : Number(next))
                    }}
                    {...rest}
                  />
                </Form.Control>
                <Form.Hint>
                  {t(
                    "quotes.fields.dutyRateHint",
                    "Applied to goods + freight. 0% is a real answer — AI-ECTA makes Indian textiles duty-free into Australia."
                  )}
                </Form.Hint>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />

          <Form.Field
            control={form.control}
            name="import_tax_rate_percent"
            render={({ field: { onChange, value, ...rest } }) => (
              <Form.Item>
                <Form.Label>
                  {t("quotes.fields.importTaxRate", "Import VAT / GST %")}
                </Form.Label>
                <Form.Control>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    placeholder="21"
                    value={value ?? ""}
                    onChange={(e) => {
                      const next = e.target.value
                      onChange(next === "" ? null : Number(next))
                    }}
                    {...rest}
                  />
                </Form.Control>
                <Form.Hint>
                  {t(
                    "quotes.fields.importTaxRateHint",
                    "Applied to goods + freight + duty — it is charged on a value that already includes the duty, and it is usually the largest of the three."
                  )}
                </Form.Hint>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />

          <Form.Field
            control={form.control}
            name="ddp_fee_total"
            render={({ field: { onChange, value, ...rest } }) => (
              <Form.Item>
                <Form.Label optional>
                  {t("quotes.fields.ddpFee", "Carrier clearance fee")}
                </Form.Label>
                <Form.Control>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="0.00"
                    value={value ?? ""}
                    onChange={(e) => {
                      const next = e.target.value
                      onChange(next === "" ? null : Number(next))
                    }}
                    {...rest}
                  />
                </Form.Control>
                <Form.Hint>
                  {t(
                    "quotes.fields.ddpFeeHint",
                    "What the carrier charges for advancing the duty and tax (DHL calls it duty-tax-paid). In the quote's currency."
                  )}
                </Form.Hint>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />

          <div className="md:col-span-3">
            <Form.Field
              control={form.control}
              name="duty_basis"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label>
                    {t("quotes.fields.dutyBasis", "How you got these rates")}
                  </Form.Label>
                  <Form.Control>
                    <Input
                      placeholder="EU: 8% duty, 21% NL VAT, HS 6304.92 — DHL landed-cost planner"
                      {...field}
                      value={field.value ?? ""}
                    />
                  </Form.Control>
                  <Form.Hint>
                    {t(
                      "quotes.fields.dutyBasisHint",
                      "The amounts are computed at mint against the basket that is actually priced, and frozen with these rates — so the figure can be checked against the carrier's invoice later instead of merely believed."
                    )}
                  </Form.Hint>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}
