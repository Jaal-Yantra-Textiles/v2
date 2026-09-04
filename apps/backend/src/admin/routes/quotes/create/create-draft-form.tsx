import { zodResolver } from "@hookform/resolvers/zod"
import { Button, Heading, Input, Select, Text, toast } from "@medusajs/ui"
import { useMemo } from "react"
import { useForm, useWatch } from "react-hook-form"
import { z } from "zod"

import { Form } from "../../../components/common/form"
import { RouteFocusModal } from "../../../components/modal/route-focus-modal"
import { useRouteModal } from "../../../components/modal/use-route-modal"
import { KeyboundForm } from "../../../components/utilitites/key-bound-form"
import { usePartners } from "../../../hooks/api/partners"
import { useQuoteRegions } from "../../../hooks/api/quote-buyer-sources"
import { useCreateQuoteDraft } from "../../../hooks/api/quotes"

/**
 * Start a quote (#1446) — the draft-order create modal, mirrored.
 *
 * ## Why so few fields
 *
 * The draft-order modal asks for region, sales channel, customer and address,
 * then saves. It does not ask for items: those are added to the draft
 * afterwards, on its own page. This asks the same question in our terms.
 *
 * 🔑 The required set is the TABLE's, not a taste judgement. `partner_quote`
 * has exactly five NOT NULL columns and only three of them can be supplied by a
 * human here — `partner_id`, `destination_country_code`, `currency_code`. That
 * is also why region leads: the region is what supplies the currency, so an
 * operator never types a currency that no region supports.
 *
 * Partner comes even before region, because every quote is partner-scoped: the
 * partner decides which catalogue the variants come from and which location
 * freight is quoted from.
 */
const CreateDraftSchema = z.object({
  partner_id: z.string().min(1, "Pick the partner this quote belongs to."),
  region_id: z.string().min(1, "Pick a region — it sets the currency."),
  currency_code: z.string().min(1),
  destination_country_code: z.string().min(1, "Pick where this ships."),
  destination_postal_code: z.string().optional(),
  destination_city: z.string().optional(),
  buyer_email: z.string().email("A valid email, or leave it blank.").or(z.literal("")),
  recipient_company: z.string().optional(),
  recipient_name: z.string().optional(),
})

type CreateDraftSchemaType = z.infer<typeof CreateDraftSchema>

/** Label on the left with its reason, control on the right. */
const Row = ({
  label,
  description,
  children,
}: {
  label: string
  description: string
  children: React.ReactNode
}) => (
  <div className="grid grid-cols-1 gap-4 border-b border-dashed py-6 last:border-0 md:grid-cols-[220px_1fr]">
    <div>
      <Text size="small" weight="plus">
        {label}
      </Text>
      <Text size="small" className="text-ui-fg-subtle">
        {description}
      </Text>
    </div>
    <div className="flex flex-col gap-y-4">{children}</div>
  </div>
)

export const CreateDraftForm = () => {
  /**
   * 🔴 `handleSuccess`, not a bare `navigate`.
   *
   * The modal guards against losing work: navigating away with a dirty form
   * raises "You have unsaved changes that will be lost if you exit this form."
   * After a SUCCESSFUL save those changes are not unsaved — they are a row —
   * so a raw navigate showed the operator a data-loss warning about work that
   * had just been persisted, and blocked the redirect behind it.
   */
  const { handleSuccess } = useRouteModal()
  const { partners } = usePartners({ limit: 200 } as any)
  const { regions } = useQuoteRegions()

  const form = useForm<CreateDraftSchemaType>({
    defaultValues: {
      partner_id: "",
      region_id: "",
      currency_code: "",
      destination_country_code: "",
      destination_postal_code: "",
      destination_city: "",
      buyer_email: "",
      recipient_company: "",
      recipient_name: "",
    },
    resolver: zodResolver(CreateDraftSchema) as any,
  })

  const selectedRegionId = useWatch({ control: form.control, name: "region_id" })

  const region = useMemo(
    () => (regions ?? []).find((r: any) => r.id === selectedRegionId) ?? null,
    [regions, selectedRegionId]
  )

  /**
   * The region writes the currency; nobody types it. Currency and destination
   * used to be two free-text boxes, which let an operator quote INR to a GB
   * address — a combination no region supports.
   */
  const onRegionChange = (value: string) => {
    const next = (regions ?? []).find((r: any) => r.id === value)
    form.setValue("region_id", value, { shouldDirty: true })
    if (!next) return
    form.setValue("currency_code", next.currency_code, { shouldDirty: true })

    const current = form.getValues("destination_country_code")
    form.setValue(
      "destination_country_code",
      next.countries.includes(current) ? current : (next.countries[0] ?? ""),
      { shouldDirty: true }
    )
  }

  const { mutate: create, isPending } = useCreateQuoteDraft({
    onSuccess: (data: any) => {
      toast.success("Draft started. Add the items next.")
      /**
       * Straight to the draft. The row exists now, so there is somewhere to go
       * — which is the whole difference from the wizard this replaced, where
       * nothing was persisted until the very last step.
       */
      handleSuccess(`/quotes/drafts/${data.draft.id}`)
    },
    onError: (e: any) =>
      toast.error(e?.message ?? "Could not start the draft."),
  })

  const handleSubmit = form.handleSubmit((data) =>
    create({
      partner_id: data.partner_id,
      region_id: data.region_id,
      currency_code: data.currency_code,
      destination_country_code: data.destination_country_code,
      // Blank means "not given", never an empty string in the column.
      destination_postal_code: data.destination_postal_code || null,
      destination_city: data.destination_city || null,
      buyer_email: data.buyer_email || null,
      recipient_company: data.recipient_company || null,
      recipient_name: data.recipient_name || null,
    })
  )

  return (
    <RouteFocusModal.Form form={form}>
      <KeyboundForm onSubmit={handleSubmit} className="flex h-full flex-col">
        {/*
          🔑 A real `Title`, not an empty header. Radix warns —
          "`DialogContent` requires a `DialogTitle` … to be accessible for
          screen reader users" — and a screen reader announcing an untitled
          dialog is a real defect, not console noise. Caught by reading the
          console on the render, which is the only place it appears.
        */}
        <RouteFocusModal.Header>
          <RouteFocusModal.Title asChild>
            <span className="sr-only">Start a quote</span>
          </RouteFocusModal.Title>
        </RouteFocusModal.Header>
        <RouteFocusModal.Body className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[720px] px-6 py-8">
            <Heading level="h1">Start a quote</Heading>
            <Text size="small" className="text-ui-fg-subtle mb-4">
              Just enough to open the draft. Items, freight and duty terms are
              added to it next — nothing is priced until you mint.
            </Text>

            <Row
              label="Partner"
              description="Whose catalogue is priced, and where freight ships from."
            >
              <Form.Field
                control={form.control}
                name="partner_id"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Control>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <Select.Trigger>
                          <Select.Value placeholder="Select a partner" />
                        </Select.Trigger>
                        <Select.Content>
                          {((partners ?? []) as any[]).map((p) => (
                            <Select.Item key={p.id} value={p.id}>
                              {p.name || p.id}
                            </Select.Item>
                          ))}
                        </Select.Content>
                      </Select>
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />
            </Row>

            <Row
              label="Region"
              description="Sets the currency and the destinations this quote can reach."
            >
              <Form.Field
                control={form.control}
                name="region_id"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Control>
                      <Select value={field.value} onValueChange={onRegionChange}>
                        <Select.Trigger>
                          <Select.Value placeholder="Select a region" />
                        </Select.Trigger>
                        <Select.Content>
                          {((regions ?? []) as any[]).map((r) => (
                            <Select.Item key={r.id} value={r.id}>
                              {r.name} · {String(r.currency_code).toUpperCase()}
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
                      {/* Written by the region, never typed. */}
                      <Input {...field} disabled placeholder="Pick a region first" />
                    </Form.Control>
                  </Form.Item>
                )}
              />
            </Row>

            <Row
              label="Ships to"
              description="The destination decides the tax treatment and the freight lane."
            >
              <Form.Field
                control={form.control}
                name="destination_country_code"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>Country</Form.Label>
                    <Form.Control>
                      {/*
                        🔴 `key` on the region, so the Select REMOUNTS when the
                        region changes.
                        
                        Picking a region writes the region's first country into
                        the form — and at that instant this Select has no
                        `Select.Item`s yet, because its options are derived from
                        the region that is only now being set. Radix resolves a
                        controlled `value` against the items mounted at the
                        time, finds none, and shows the PLACEHOLDER — then never
                        recovers once the items appear. The form held "sg" while
                        the screen said "Select a country", and submitting
                        answered "Pick where this ships" over a field that was
                        not empty.

                        Nothing in tsc or the tests can see this; it took
                        driving the form in a browser.
                      */}
                      <Select
                        key={region?.id ?? "no-region"}
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
                          {(region?.countries ?? []).map((c: string) => (
                            <Select.Item key={c} value={c}>
                              {c.toUpperCase()}
                            </Select.Item>
                          ))}
                        </Select.Content>
                      </Select>
                    </Form.Control>
                    {/*
                      🔴 A region CAN declare no countries — `useQuoteRegions`
                      says so in as many words — and one of ours does. Without
                      this the operator picks that region, gets an empty
                      dropdown and is then told "Pick where this ships", with
                      nothing there to pick and no hint that the region is the
                      reason. Found by driving the form, not by reading it.
                    */}
                    {region && !region.countries.length && (
                      <Text size="small" className="text-ui-fg-error">
                        {region.name} declares no countries, so nothing can be
                        shipped to it. Pick another region, or add countries to
                        this one first.
                      </Text>
                    )}
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />
              <div className="grid grid-cols-2 gap-x-4">
                <Form.Field
                  control={form.control}
                  name="destination_postal_code"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>Postal code</Form.Label>
                      <Form.Control>
                        <Input {...field} placeholder="400001" />
                      </Form.Control>
                    </Form.Item>
                  )}
                />
                <Form.Field
                  control={form.control}
                  name="destination_city"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>City</Form.Label>
                      <Form.Control>
                        <Input {...field} />
                      </Form.Control>
                    </Form.Item>
                  )}
                />
              </div>
            </Row>

            <Row
              label="Buyer"
              description="Optional here — the draft can be built before you know who it is for."
            >
              <Form.Field
                control={form.control}
                name="buyer_email"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>Email</Form.Label>
                    <Form.Control>
                      <Input {...field} placeholder="procurement@example.com" />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />
              <div className="grid grid-cols-2 gap-x-4">
                <Form.Field
                  control={form.control}
                  name="recipient_company"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>Company</Form.Label>
                      <Form.Control>
                        <Input {...field} />
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
                        <Input {...field} />
                      </Form.Control>
                    </Form.Item>
                  )}
                />
              </div>
            </Row>
          </div>
        </RouteFocusModal.Body>
        <RouteFocusModal.Footer>
          <div className="flex items-center justify-end gap-x-2">
            <RouteFocusModal.Close asChild>
              <Button variant="secondary" size="small">
                Cancel
              </Button>
            </RouteFocusModal.Close>
            <Button type="submit" variant="primary" size="small" isLoading={isPending}>
              Save
            </Button>
          </div>
        </RouteFocusModal.Footer>
      </KeyboundForm>
    </RouteFocusModal.Form>
  )
}
