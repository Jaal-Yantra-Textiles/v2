import { Heading, Input, Select, Text, Textarea } from "@medusajs/ui"
import { useMemo, useState } from "react"
import { UseFormReturn, useWatch } from "react-hook-form"

import { Form } from "../../../../components/common/form"
import { Combobox } from "../../../../components/inputs/combobox/combobox"
import {
  useQuoteBuyerOptions,
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
export const BuyerStep = ({ form }: Props) => {
  const [search, setSearch] = useState("")
  const { regions } = useQuoteRegions()
  const { options: buyers } = useQuoteBuyerOptions(search)

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
    </div>
  )
}
