import { Heading, Input, Select, Switch, Text, Textarea } from "@medusajs/ui"
import { useMemo, useState } from "react"
import { UseFormReturn, useWatch } from "react-hook-form"

import { Form } from "../../../../components/common/form"
import { Combobox } from "../../../../components/inputs/combobox/combobox"
import {
  useQuoteBuyerOptions,
  useQuoteCarriers,
  useQuoteRegions,
} from "../../../../hooks/api/quote-buyer-sources"
import { AdminQuoteCreateSchemaType } from "../schema"

type Props = { form: UseFormReturn<AdminQuoteCreateSchemaType> }

/**
 * Step 2 — who the quote is for, and where it lands.
 *
 * ## The region is the field; currency and country are consequences
 *
 * This step used to ask for a currency and a destination country as two free
 * text inputs. That let an operator type "inr" against a GB address — a
 * combination no region supports, so the mint priced against nothing and the
 * preflight refused it only after every other step had been filled in.
 *
 * 🔑 A region carries both facts, so picking one SETS the currency and narrows
 * the country list to the ones it actually covers. The impossible combination
 * stops being expressible rather than being validated after the fact. The
 * currency stays visible but read-only: an operator needs to see what the
 * buyer will be quoted in, and needs not to be able to contradict the region.
 *
 * ## Two buyer lists, one field
 *
 * Existing customers AND CRM people, because a B2B quote is usually the FIRST
 * thing a lead ever receives — they are not a customer yet. Both resolve to an
 * email, which is the only thing the mint uses: it find-or-creates the buyer by
 * address, scoped to the partner's store. A typed address that matches nothing
 * must therefore stay selectable, or the wizard could only ever quote people
 * who had already bought.
 */
/**
 * Sentinels for the carrier picker — neither is ever sent to the API.
 *
 * 🔴 `DEFAULT_CARRIER` exists because Radix REFUSES a `Select.Item` with
 * `value=""`: the empty string is reserved for "cleared, show the placeholder",
 * so an item claiming it throws and takes the whole step down with it. The
 * field's own empty value still means "platform default" — the sentinel only
 * lives inside the picker.
 */
const DEFAULT_CARRIER = "__default__"
/** The "type it yourself" branch, for a carrier registered after this build. */
const OTHER_CARRIER = "__other__"

export const BuyerStep = ({ form }: Props) => {
  const [search, setSearch] = useState("")
  const { regions } = useQuoteRegions()
  const { options: buyers } = useQuoteBuyerOptions(search)

  const partnerId = useWatch({ control: form.control, name: "partner_id" })
  const { options: carriers, originCountryCode } = useQuoteCarriers(partnerId)
  const carrier = useWatch({ control: form.control, name: "carrier" })
  const destinationCountry = useWatch({
    control: form.control,
    name: "destination_country_code",
  })
  const dutiesPrepaid = useWatch({ control: form.control, name: "duties_prepaid" })

  const knownCarrierIds = useMemo(
    () => new Set([...carriers.map((c) => c.id), "manual"]),
    [carriers]
  )
  /**
   * Held in state rather than inferred from the value, because "typing one"
   * starts from an EMPTY field — inferring would collapse the branch the moment
   * it opened, before a character was typed.
   */
  const [typingCarrier, setTypingCarrier] = useState(false)
  const isOtherCarrier =
    typingCarrier || (Boolean(carrier) && !knownCarrierIds.has(carrier ?? ""))

  /**
   * 🔴 The one warning worth interrupting for: quoting DDP on a carrier that
   * cannot be TOLD the shipment is DDP. The promise is still keepable — someone
   * arranges clearance by hand — but it stops being automatic, and the failure
   * is otherwise silent until the buyer meets a customs bill we said would not
   * come. Today only Blue Dart's payload carries an incoterm at all.
   */
  /**
   * DDP only means something across a border (#1447).
   *
   * On a domestic lane there is no import duty and no import tax to prepay, so
   * the section is hidden rather than shown-and-ignored: an operator who ticks
   * it on a Mumbai→Delhi quote would add charges for a customs event that never
   * happens. The mint refuses it too — hiding a field is a UI convention, and
   * the API is reachable without one.
   *
   * Unknown origin keeps the section VISIBLE. The cost of asking about duty on
   * a domestic quote is a moment's confusion; the cost of hiding it on a real
   * export is a buyer meeting a customs bill we said would not come.
   */
  const isDomesticLane = useMemo(() => {
    const origin = String(originCountryCode || "").toUpperCase()
    const destination = String(destinationCountry || "").toUpperCase()
    if (!/^[A-Z]{2}$/.test(origin) || !/^[A-Z]{2}$/.test(destination)) {
      return false
    }
    return origin === destination
  }, [originCountryCode, destinationCountry])

  const ddpWarning = useMemo(() => {
    if (!dutiesPrepaid) return null
    const picked = carriers.find((c) => c.id === carrier)
    if (!picked) {
      return "This quote promises DDP. Nothing on the default rate source can declare a shipment duty-paid, so clearance has to be arranged by hand."
    }
    return picked.can_declare_ddp
      ? `${picked.label} can be told the shipment is DDP — the incoterm follows the sale.`
      : `${picked.label} cannot declare a shipment DDP, so the duty we promised has to be arranged with the carrier by hand.`
  }, [carrier, carriers, dutiesPrepaid])

  const regionId = useWatch({ control: form.control, name: "region_id" })
  const region = useMemo(
    () => regions.find((r) => r.id === regionId) ?? null,
    [regions, regionId]
  )

  const onRegionChange = (value: string) => {
    const next = regions.find((r) => r.id === value)
    form.setValue("region_id", value, { shouldDirty: true })
    if (!next) return

    form.setValue("currency_code", next.currency_code, { shouldDirty: true })

    // Keep a country the operator already chose if the new region covers it;
    // otherwise fall to the region's first. Silently clearing a destination
    // they typed would be worse than moving it somewhere the region supports.
    const current = form.getValues("destination_country_code")
    const nextCountry = next.countries.includes(current)
      ? current
      : next.countries[0] ?? ""
    form.setValue("destination_country_code", nextCountry, { shouldDirty: true })
  }

  const buyerOptions = buyers.map((b) => ({
    label: b.source === "lead" ? `${b.label} · lead` : b.label,
    value: b.email,
  }))

  const onBuyerSelected = (email: string) => {
    const picked = buyers.find((b) => b.email === email)
    if (!picked) return
    // Only fill what is EMPTY. An operator who has already typed a company
    // name meant it; a picker that overwrote it would lose a correction with
    // no undo.
    if (!form.getValues("recipient_company") && picked.company) {
      form.setValue("recipient_company", picked.company, { shouldDirty: true })
    }
    if (!form.getValues("recipient_name") && picked.name) {
      form.setValue("recipient_name", picked.name, { shouldDirty: true })
    }
  }

  return (
    <div className="flex flex-col gap-y-8">
      <div className="flex flex-col gap-y-1">
        <Heading level="h2">Buyer</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Pick an existing customer or a CRM lead, or type a new address —
          either way the buyer is matched by email, and created if they are new.
        </Text>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Form.Field
          control={form.control}
          name="buyer_email"
          render={({ field }) => (
            <Form.Item>
              <Form.Label>Buyer email</Form.Label>
              <Form.Control>
                <Combobox
                  options={buyerOptions}
                  searchValue={search}
                  onSearchValueChange={setSearch}
                  placeholder="procurement@example.com"
                  /**
                   * A brand-new buyer is the common case for a B2B quote, so a
                   * typed address that matches nothing must still be
                   * selectable — the mint creates the customer. Without this
                   * the wizard could only ever quote people who had already
                   * bought.
                   */
                  onCreateOption={(value) => field.onChange(value)}
                  noResultsPlaceholder="Press enter to quote a new buyer"
                  {...field}
                  value={field.value ?? ""}
                  onChange={(value?: string | string[]) => {
                    field.onChange(value)
                    if (typeof value === "string") onBuyerSelected(value)
                  }}
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
              <Form.Label>Company</Form.Label>
              <Form.Control>
                <Input {...field} value={field.value ?? ""} />
              </Form.Control>
            </Form.Item>
          )}
        />

        {/*
          The buyer's registration, for the document header (#1486).

          🔑 Nothing checks it against VIES or the GST portal, and the hint says
          so — a field that reads as verified invites a reverse-charge
          assumption nobody is entitled to make.
        */}
        <div className="grid grid-cols-2 gap-x-3">
          <Form.Field
            control={form.control}
            name="buyer_tax_id"
            render={({ field }) => (
              <Form.Item>
                <Form.Label optional>VAT / tax number</Form.Label>
                <Form.Control>
                  <Input {...field} value={field.value ?? ""} placeholder="DE123456789" />
                </Form.Control>
                <Form.Hint>
                  As the buyer gave it. Shown on the quote; it does not change
                  the price or the tax.
                </Form.Hint>
              </Form.Item>
            )}
          />

          <Form.Field
            control={form.control}
            name="buyer_tax_id_type"
            render={({ field }) => (
              <Form.Item>
                <Form.Label optional>Scheme</Form.Label>
                <Form.Control>
                  <Input {...field} value={field.value ?? ""} placeholder="eu_vat" />
                </Form.Control>
              </Form.Item>
            )}
          />
        </div>

        <Form.Field
          control={form.control}
          name="recipient_name"
          render={({ field }) => (
            <Form.Item>
              <Form.Label>Contact name</Form.Label>
              <Form.Control>
                <Input {...field} value={field.value ?? ""} />
              </Form.Control>
            </Form.Item>
          )}
        />

        <Form.Field
          control={form.control}
          name="region_id"
          render={({ field }) => (
            <Form.Item>
              <Form.Label>Region</Form.Label>
              <Form.Control>
                <Select value={field.value} onValueChange={onRegionChange}>
                  <Select.Trigger>
                    <Select.Value placeholder="Select a region" />
                  </Select.Trigger>
                  <Select.Content>
                    {regions.map((r) => (
                      <Select.Item key={r.id} value={r.id}>
                        {r.name} · {r.currency_code.toUpperCase()}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select>
              </Form.Control>
              <Form.Hint>
                Sets the currency and the destinations this quote can reach.
              </Form.Hint>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />

        <Form.Field
          control={form.control}
          name="destination_country_code"
          render={({ field }) => (
            <Form.Item>
              <Form.Label>Destination country</Form.Label>
              <Form.Control>
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  disabled={!region}
                >
                  <Select.Trigger>
                    <Select.Value
                      placeholder={
                        region ? "Select a country" : "Pick a region first"
                      }
                    />
                  </Select.Trigger>
                  <Select.Content>
                    {(region?.countries ?? []).map((c) => (
                      <Select.Item key={c} value={c}>
                        {c.toUpperCase()}
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
          name="currency_code"
          render={({ field }) => (
            <Form.Item>
              <Form.Label>Currency</Form.Label>
              <Form.Control>
                {/* Read-only on purpose: it comes from the region, and an
                    operator who could contradict it would be quoting a
                    currency the region cannot price. */}
                <Input
                  {...field}
                  value={String(field.value ?? "").toUpperCase()}
                  readOnly
                  disabled
                />
              </Form.Control>
            </Form.Item>
          )}
        />

        <Form.Field
          control={form.control}
          name="destination_postal_code"
          render={({ field }) => (
            <Form.Item>
              <Form.Label>Destination postal code</Form.Label>
              <Form.Control>
                <Input {...field} value={field.value ?? ""} placeholder="400001" />
              </Form.Control>
              <Form.Hint>
                Freight is quoted against this. Without it the lane falls back
                to a country-level rate.
              </Form.Hint>
            </Form.Item>
          )}
        />

        <Form.Field
          control={form.control}
          name="ttl_days"
          render={({ field }) => (
            <Form.Item>
              <Form.Label>Valid for (days)</Form.Label>
              <Form.Control>
                <Input
                  type="number"
                  min={1}
                  max={365}
                  value={field.value ?? ""}
                  onChange={(e) =>
                    field.onChange(
                      e.target.value === "" ? undefined : Number(e.target.value)
                    )
                  }
                />
              </Form.Control>
              <Form.Hint>
                Becomes the price list's end date, so expiry is enforced by
                core rather than swept by a job.
              </Form.Hint>
            </Form.Item>
          )}
        />
        <Form.Field
          control={form.control}
          name="deposit_pct"
          render={({ field: { onChange, value, ...rest } }) => (
            <Form.Item>
              <Form.Label optional>Deposit (%)</Form.Label>
              <Form.Control>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  placeholder="30"
                  // 🔑 `...rest` carries `name`, `ref` and `onBlur` from
                  // react-hook-form onto the element. Reading `field.value` and
                  // `field.onChange` alone renders an input with NO name
                  // attribute — it looks and behaves right, and is invisible to
                  // anything selecting the form by field name. Caught by the
                  // e2e spec, not by tsc, which sees a perfectly typed prop.
                  {...rest}
                  value={value ?? ""}
                  onChange={(e) =>
                    // Only an EMPTY string is "unset". `Number("0")` is 0 and
                    // has to survive as 0 — taking nothing up front is a real
                    // term, and losing it hands the buyer a 30% demand nobody
                    // agreed to.
                    onChange(
                      e.target.value === "" ? undefined : Number(e.target.value)
                    )
                  }
                />
              </Form.Control>
              <Form.Hint>
                What the buyer pays on accepting; the rest is invoiced when the
                goods are ready. Blank uses the default 30%.
              </Form.Hint>
            </Form.Item>
          )}
        />
      </div>

      <Form.Field
        control={form.control}
        name="partner_note"
        render={({ field }) => (
          <Form.Item>
            <Form.Label>Note to the buyer</Form.Label>
            <Form.Control>
              <Textarea {...field} value={field.value ?? ""} rows={3} />
            </Form.Control>
          </Form.Item>
        )}
      />

      <div className="flex flex-col gap-y-1">
        <Heading level="h2">Freight source</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Which carrier is asked for a live rate on this lane. Manual and flat
          shipping options are always included whatever is picked here, so a
          lane no carrier will quote still prices.
        </Text>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Form.Field
          control={form.control}
          name="carrier"
          render={({ field }) => (
            <Form.Item>
              <Form.Label optional>Carrier</Form.Label>
              <Form.Control>
                <Select
                  value={
                    isOtherCarrier
                      ? OTHER_CARRIER
                      : field.value
                        ? field.value
                        : DEFAULT_CARRIER
                  }
                  onValueChange={(value) => {
                    if (value === OTHER_CARRIER) {
                      setTypingCarrier(true)
                      field.onChange("")
                      return
                    }
                    setTypingCarrier(false)
                    // The FIELD's empty string still means "platform default" —
                    // only the picker needs a non-empty token for that row.
                    field.onChange(value === DEFAULT_CARRIER ? "" : value)
                  }}
                >
                  <Select.Trigger>
                    <Select.Value placeholder="Platform default (Shiprocket)" />
                  </Select.Trigger>
                  <Select.Content>
                    <Select.Item value={DEFAULT_CARRIER}>
                      Platform default (Shiprocket)
                    </Select.Item>
                    {carriers.map((c) => (
                      <Select.Item
                        key={c.id}
                        value={c.id}
                        disabled={!c.available}
                      >
                        {c.label}
                        {c.can_declare_ddp ? " · can ship DDP" : ""}
                        {c.available ? "" : ` · ${c.blocked_reason ?? "unavailable"}`}
                      </Select.Item>
                    ))}
                    {/* A lane priced entirely by the partner's own manual
                        tiers — no carrier is called at all. */}
                    <Select.Item value="manual">
                      Manual rates only — ask no carrier
                    </Select.Item>
                    <Select.Item value={OTHER_CARRIER}>
                      Other — type a carrier id
                    </Select.Item>
                  </Select.Content>
                </Select>
              </Form.Control>
              <Form.Hint>
                {ddpWarning ??
                  "Leave on the default unless this lane is quoted somewhere else."}
              </Form.Hint>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />

        {isOtherCarrier ? (
          <Form.Field
            control={form.control}
            name="carrier"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>Carrier id</Form.Label>
                <Form.Control>
                  <Input
                    autoFocus
                    placeholder="e.g. bluedart"
                    value={field.value ?? ""}
                    onChange={(e) => field.onChange(e.target.value)}
                  />
                </Form.Control>
                <Form.Hint>
                  The id the adapter registers under. A carrier this deployment
                  has no client for cannot return a rate — the quote falls back
                  to manual options rather than failing, so check the spelling.
                </Form.Hint>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Form.Field
          control={form.control}
          name="freight_override_amount"
          render={({ field: { onChange, value, ...rest } }) => (
            <Form.Item>
              <Form.Label optional>Freight, quoted by hand</Form.Label>
              <Form.Control>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="e.g. 250"
                  {...rest}
                  value={value ?? ""}
                  onChange={(e) =>
                    onChange(
                      e.target.value === "" ? undefined : Number(e.target.value)
                    )
                  }
                />
              </Form.Control>
              <Form.Hint>
                In the quote's currency. Overrides whatever the lane rates at —
                use it when no carrier will quote the lane, or when the stored
                tier is wrong for this weight. Leave blank to use the rate.
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
              <Form.Label optional>Where that figure came from</Form.Label>
              <Form.Control>
                <Input
                  placeholder="DHL rate card 12 Aug, 22 kg to DE"
                  {...field}
                  value={field.value ?? ""}
                />
              </Form.Control>
              <Form.Hint>
                Evidence, not decoration: whoever meets the forwarder's invoice
                is not who typed the number.
              </Form.Hint>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />
      </div>

      {isDomesticLane ? (
        <Text size="small" className="text-ui-fg-muted">
          This quote ships within{" "}
          {String(destinationCountry || "").toUpperCase()}, so there is no
          import duty or tax to prepay — the DDP options do not apply.
        </Text>
      ) : null}

      <div className={isDomesticLane ? "hidden" : "flex flex-col gap-y-1"}>
        <Heading level="h2">Import duty (DDP)</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Only meaningful on an export. With this on the buyer is told there is
          nothing further to pay on delivery — which means we pay their customs
          bill, and until a carrier can price and clear it DDP, somebody
          arranges that by hand.
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
                <Form.Label>We pay the import duty</Form.Label>
                <Form.Hint>
                  Off means the buyer is importer of record: duty and import VAT
                  are theirs, and the quote says so in as many words.
                </Form.Hint>
              </div>
              <Form.Control>
                <Switch
                  checked={Boolean(value)}
                  onCheckedChange={(checked) => {
                    onChange(checked)
                    if (!checked) {
                      // A stray amount on a non-DDP quote would be added to a
                      // total whose buyer was told duty is theirs to pay.
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
            render={({ field }) => (
              <Form.Item>
                <Form.Label>Duty rate %</Form.Label>
                <Form.Control>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    placeholder="8"
                    value={field.value ?? ""}
                    onChange={(e) =>
                      field.onChange(
                        e.target.value === "" ? null : Number(e.target.value)
                      )
                    }
                  />
                </Form.Control>
                <Form.Hint>
                  Applied to goods + freight. 0% is a real answer — AI-ECTA
                  makes Indian textiles duty-free into Australia.
                </Form.Hint>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />

          <Form.Field
            control={form.control}
            name="import_tax_rate_percent"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>Import VAT / GST %</Form.Label>
                <Form.Control>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    placeholder="21"
                    value={field.value ?? ""}
                    onChange={(e) =>
                      field.onChange(
                        e.target.value === "" ? null : Number(e.target.value)
                      )
                    }
                  />
                </Form.Control>
                <Form.Hint>
                  Charged on goods + freight + duty — a value that already
                  includes the duty. Usually the largest of the three.
                </Form.Hint>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />

          <Form.Field
            control={form.control}
            name="ddp_fee_total"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>Carrier clearance fee</Form.Label>
                <Form.Control>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="0.00"
                    value={field.value ?? ""}
                    onChange={(e) =>
                      field.onChange(
                        e.target.value === "" ? null : Number(e.target.value)
                      )
                    }
                  />
                </Form.Control>
                <Form.Hint>
                  What the carrier charges to advance the duty and tax — DHL
                  calls it duty-tax-paid. In the quote's currency.
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
                  <Form.Label>How you got these rates</Form.Label>
                  <Form.Control>
                    <Input
                      placeholder="EU: 8% duty, 21% NL VAT, HS 6304.92 — DHL landed-cost planner"
                      {...field}
                      value={field.value ?? ""}
                    />
                  </Form.Control>
                  <Form.Hint>
                    The amounts are computed at mint against the basket that is
                    actually priced and frozen alongside these rates, so the
                    figure can be checked against the carrier's invoice later
                    rather than merely believed.
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
