import { Heading, Input, Select, Text, Textarea } from "@medusajs/ui"
import { useMemo, useState } from "react"
import { UseFormReturn, useWatch } from "react-hook-form"

import { Form } from "../../../../components/common/form"
import { Combobox } from "../../../../components/inputs/combobox/combobox"
import { useQuoteBuyerOptions, useQuoteRegions } from "../../../../hooks/api/quote-buyer-sources"
import { SinglePartnerCombobox } from "./partner-combobox"
import { BriefFormValues } from "./schema"

/**
 * Step 1: whose store the link lives on, and who the buyer is. Region and
 * country are the same pair the quote uses: the region decides which
 * countries exist and the currency her page shows estimates in.
 */
export const BriefBuyerStep = ({ form }: { form: UseFormReturn<BriefFormValues> }) => {
  const { regions } = useQuoteRegions()
  const regionId = useWatch({ control: form.control, name: "region_id" })
  const region = useMemo(() => regions.find((r) => r.id === regionId) ?? null, [regions, regionId])

  const [buyerSearch, setBuyerSearch] = useState("")
  const { options: buyers } = useQuoteBuyerOptions(buyerSearch)

  const onRegionChange = (id: string) => {
    const next = regions.find((r) => r.id === id)
    form.setValue("region_id", id, { shouldDirty: true, shouldValidate: true })
    const current = form.getValues("destination_country_code")
    form.setValue("destination_country_code", next?.countries.includes(current) ? current : next?.countries[0] ?? "", {
      shouldDirty: true,
    })
  }

  const onBuyerPicked = (email: string) => {
    const picked = buyers.find((b) => b.email === email)
    // Only fill what is empty; a name already typed was meant.
    if (!form.getValues("recipient_name") && picked?.name) form.setValue("recipient_name", picked.name)
    if (!form.getValues("recipient_company") && picked?.company) form.setValue("recipient_company", picked.company)
  }

  return (
    <div className="flex flex-col items-center p-16">
      <div className="flex w-full max-w-[720px] flex-col gap-y-8">
        <div>
          <Heading>New brief</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Who it is for, and whose store the link lives on. Nothing is sent; you get the buyer's link when you open the brief.
          </Text>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Form.Field
            control={form.control}
            name="partner_id"
            render={({ field }) => (
              <Form.Item className="md:col-span-2">
                <Form.Label>Lead partner</Form.Label>
                <Form.Hint>The seller. The buyer's link lives on their store.</Form.Hint>
                <Form.Control>
                  <SinglePartnerCombobox
                    value={field.value ? { id: field.value, name: form.getValues("partner_name") } : null}
                    onChange={(p) => {
                      form.setValue("partner_name", p?.name ?? "")
                      field.onChange(p?.id ?? "")
                    }}
                  />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
          <Form.Field
            control={form.control}
            name="title"
            render={({ field }) => (
              <Form.Item className="md:col-span-2">
                <Form.Label>Title</Form.Label>
                <Form.Control>
                  <Input {...field} placeholder="Round crossbody bags, made by hand" />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
        </div>

        <div className="flex flex-col gap-y-4">
          <div>
            <Heading level="h2">Buyer</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              Pick an existing customer or CRM lead, or type a new email.
            </Text>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Form.Field
              control={form.control}
              name="buyer_email"
              render={({ field }) => (
                <Form.Item className="md:col-span-2">
                  <Form.Label optional>Email</Form.Label>
                  <Form.Control>
                    <Combobox
                      options={buyers.map((b) => ({ label: b.source === "lead" ? `${b.label} · lead` : b.label, value: b.email }))}
                      searchValue={buyerSearch}
                      onSearchValueChange={setBuyerSearch}
                      placeholder="buyer@example.com"
                      onCreateOption={(v) => field.onChange(v)}
                      noResultsPlaceholder="Press enter to use a new email"
                      value={field.value ?? ""}
                      onChange={(v?: string | string[]) => {
                        field.onChange(v ?? "")
                        if (typeof v === "string") onBuyerPicked(v)
                      }}
                    />
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
                  <Form.Label optional>Contact name</Form.Label>
                  <Form.Control>
                    <Input {...field} />
                  </Form.Control>
                </Form.Item>
              )}
            />
            <Form.Field
              control={form.control}
              name="recipient_company"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label optional>Company</Form.Label>
                  <Form.Control>
                    <Input {...field} />
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
                  <Form.Hint>Her page shows estimates in this currency.</Form.Hint>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />
            <Form.Field
              control={form.control}
              name="destination_country_code"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label>Country</Form.Label>
                  <Form.Control>
                    {/* key on the region: Radix needs the items mounted before the value lands. */}
                    <Select key={region?.id ?? "no-region"} value={field.value} onValueChange={field.onChange} disabled={!region}>
                      <Select.Trigger>
                        <Select.Value placeholder={region ? "Select a country" : "Pick a region first"} />
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
          </div>
        </div>

        <div className="flex flex-col gap-y-4">
          <Heading level="h2">Samples and welcome</Heading>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Form.Field
              control={form.control}
              name="sample_quantity"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label optional>Sample pieces first</Form.Label>
                  <Form.Control>
                    <Input type="number" {...field} />
                  </Form.Control>
                </Form.Item>
              )}
            />
            <Form.Field
              control={form.control}
              name="sample_days"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label optional>Days to sample photos</Form.Label>
                  <Form.Control>
                    <Input type="number" {...field} />
                  </Form.Control>
                  <Form.Hint>Our estimate.</Form.Hint>
                </Form.Item>
              )}
            />
            <Form.Field
              control={form.control}
              name="intro"
              render={({ field }) => (
                <Form.Item className="md:col-span-2">
                  <Form.Label optional>Intro</Form.Label>
                  <Form.Control>
                    <Textarea {...field} />
                  </Form.Control>
                  <Form.Hint>Shown on her welcome screen.</Form.Hint>
                </Form.Item>
              )}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
