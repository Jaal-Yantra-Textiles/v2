import { zodResolver } from "@hookform/resolvers/zod"
import {
  Button,
  Heading,
  ProgressStatus,
  ProgressTabs,
  Select,
  Text,
  toast,
} from "@medusajs/ui"
import { useState } from "react"
import { FieldPath, useForm } from "react-hook-form"

import { Form } from "../../../components/common/form"
import { RouteFocusModal } from "../../../components/modal/route-focus-modal"
import { KeyboundForm } from "../../../components/utilitites/key-bound-form"
import { usePartners } from "../../../hooks/api/partners"
import {
  QuoteReadiness,
  useAdminQuoteReadiness,
  useMintQuote,
} from "../../../hooks/api/quotes"
import { MintedPanel, type MintedQuoteResult } from "./minted-panel"
import { ReadinessPanel } from "./readiness-panel"
import {
  AdminQuoteCreateSchema,
  AdminQuoteCreateSchemaType,
  QuoteBuyerFields,
  QuoteBuyerSchema,
  QuotePartnerFields,
  QuotePartnerSchema,
  QuoteProductFields,
  QuoteProductsSchema,
} from "./schema"
import { BuyerStep } from "./steps/buyer-step"
import { ProductsStep } from "./steps/products-step"
import { QuantitiesStep } from "./steps/quantities-step"

/**
 * Mint a quote on a partner's behalf (#1419, stepped in #1444, brought to
 * parity with the partner wizard in #1446).
 *
 * ## Why it looks like the partner's wizard
 *
 * The two are the same product wearing different chrome, and they had drifted
 * badly: the partner minted through a focus-modal wizard with a customer
 * picker, a product table and an editable grid, while the admin filled in a
 * page-level form with a `<Select>` of every variant in the catalogue and two
 * free-text boxes for currency and country. Anything learned on one surface was
 * useless on the other, and the admin one could not be used against a real
 * catalogue at all.
 *
 * This is the partner's shape — `RouteFocusModal.Form` + `ProgressTabs`, one
 * step per question — with ONE extra leading step. An admin has no partner of
 * their own, and every quote is partner-scoped: the partner decides which
 * catalogue the variants come from and which location freight is quoted from,
 * so choosing products before a partner would build a basket that is then
 * rejected wholesale.
 *
 * **Partner → Buyer → Products → Quantities.**
 *
 * ## The minted panel does not navigate away
 *
 * 🔴 The raw token is returned by the API exactly once and only its sha256 is
 * stored. A successful mint therefore swaps the modal body for the panel
 * holding the only copy of the link, and does NOT call `handleSuccess` the way
 * every other create flow does — that would discard the buyer's link and force
 * a re-mint.
 */

enum Tab {
  PARTNER = "partner",
  BUYER = "buyer",
  PRODUCTS = "products",
  QUANTITIES = "quantities",
}

const tabOrder = [Tab.PARTNER, Tab.BUYER, Tab.PRODUCTS, Tab.QUANTITIES] as const

type TabState = Record<Tab, ProgressStatus>

const initialTabState: TabState = {
  [Tab.PARTNER]: "in-progress",
  [Tab.BUYER]: "not-started",
  [Tab.PRODUCTS]: "not-started",
  [Tab.QUANTITIES]: "not-started",
}

export const MintQuoteForm = () => {
  const [tab, setTab] = useState<Tab>(Tab.PARTNER)
  const [tabState, setTabState] = useState<TabState>(initialTabState)
  const [minted, setMinted] = useState<MintedQuoteResult | null>(
    null
  )
  const [readiness, setReadiness] = useState<QuoteReadiness | null>(null)

  const { partners } = usePartners({ limit: 200 } as any)

  const form = useForm<AdminQuoteCreateSchemaType>({
    defaultValues: {
      partner_id: "",
      buyer_email: "",
      recipient_name: "",
      recipient_company: "",
      partner_note: "",
      region_id: "",
      currency_code: "",
      destination_country_code: "",
      destination_postal_code: "",
      destination_city: "",
      ttl_days: 14,
      // Empty = the platform default rate source. Never "manual" by default:
      // that would silently stop asking any carrier for a live rate.
      carrier: "",
      product_ids: [],
      quantities: {},
      discounts: {},
      overrides: {},
      // Never on by default: a DDP promise nobody arranged clearance for tells
      // the buyer there is nothing to pay and then hands them a customs bill.
      duties_prepaid: false,
      duty_rate_percent: null,
      import_tax_rate_percent: null,
      ddp_fee_total: null,
      duty_basis: null,
    },
    resolver: zodResolver(AdminQuoteCreateSchema) as any,
  })

  const { mutate: mint, isPending } = useMintQuote({
    // The whole response, not two fields off it: `buyer_url` and the
    // delivery verdict are what the panel has to show (#1420).
    onSuccess: (data: any) => setMinted(data as MintedQuoteResult),
    onError: (e: any) => toast.error(e?.message ?? "Could not mint the quote."),
  })
  const { mutateAsync: checkReadiness, isPending: isChecking } =
    useAdminQuoteReadiness()

  /**
   * Validate only the fields belonging to the steps being skipped past.
   * Same mechanism the partner wizard uses: a tab cannot be reached by
   * clicking its header while an earlier one is incomplete, and the error is
   * attached to the field rather than shouted in a toast.
   */
  const partialFormValidation = (
    fields: readonly FieldPath<AdminQuoteCreateSchemaType>[],
    schema: any
  ) => {
    form.clearErrors(fields as any)

    const values = fields.reduce((acc, key) => {
      acc[key] = form.getValues(key as any)
      return acc
    }, {} as Record<string, unknown>)

    const validation = schema.safeParse(values)
    if (validation.success) return true

    for (const issue of validation.error.issues) {
      form.setError(issue.path.join(".") as any, {
        type: issue.code,
        message: issue.message,
      })
    }
    return false
  }

  const handleChangeTab = (update: Tab) => {
    if (tab === update) return

    // Going back is always allowed — an operator correcting an earlier answer
    // must not be made to re-pass the steps after it.
    if (tabOrder.indexOf(update) < tabOrder.indexOf(tab)) {
      setTabState((prev) => ({ ...prev, [update]: "in-progress" }))
      setTab(update)
      return
    }

    for (const current of tabOrder.slice(0, tabOrder.indexOf(update))) {
      if (current === Tab.PARTNER) {
        if (!partialFormValidation(QuotePartnerFields, QuotePartnerSchema)) {
          setTabState((prev) => ({ ...prev, [current]: "in-progress" }))
          setTab(current)
          return
        }
      } else if (current === Tab.BUYER) {
        if (!partialFormValidation(QuoteBuyerFields, QuoteBuyerSchema)) {
          setTabState((prev) => ({ ...prev, [current]: "in-progress" }))
          setTab(current)
          return
        }
      } else if (current === Tab.PRODUCTS) {
        if (!partialFormValidation(QuoteProductFields, QuoteProductsSchema)) {
          setTabState((prev) => ({ ...prev, [current]: "in-progress" }))
          setTab(current)
          return
        }
        if (!form.getValues("product_ids").length) {
          toast.error("Pick at least one product.")
          setTab(current)
          return
        }
      }
      setTabState((prev) => ({ ...prev, [current]: "completed" }))
    }

    setTabState((prev) => ({ ...prev, [update]: "in-progress" }))
    setTab(update)
  }

  const handleNextTab = () => {
    const i = tabOrder.indexOf(tab)
    if (i === tabOrder.length - 1) return
    handleChangeTab(tabOrder[i + 1])
  }

  const handleSubmit = form.handleSubmit(async (data) => {
    /**
     * A blank or zero quantity means "not in this basket" — dropped, not sent
     * as a zero. Same for a blank override: sent as 0 it would ask the backend
     * to mint an ACTIVE price of zero, which it refuses outright.
     */
    const lines = Object.entries(data.quantities ?? {})
      .filter(([, qty]) => typeof qty === "number" && qty > 0)
      .map(([variant_id, qty], index) => {
        const discount = data.discounts?.[variant_id]
        const override = data.overrides?.[variant_id]
        return {
          variant_id,
          quantity: qty as number,
          position: index,
          ...(typeof discount === "number" && discount > 0
            ? { discount_percent: discount }
            : {}),
          ...(typeof override === "number" && override > 0
            ? { override_unit_amount: override }
            : {}),
        }
      })

    if (!lines.length) {
      toast.error(
        "Set a quantity on at least one variant — a quote with no lines has nothing to price."
      )
      setTab(Tab.QUANTITIES)
      return
    }

    /**
     * The preflight, then the mint (#1445). Run on submit rather than per
     * keystroke: it prices every line and asks a carrier.
     *
     * 🔑 A preflight that cannot RUN does not block the mint — the workflow
     * runs the same assessor as its first step, so the real gate is there
     * either way, and failing closed here would turn a network blip into "you
     * cannot quote".
     */
    let assessed: QuoteReadiness | null = null
    try {
      const result = await checkReadiness({
        partner_id: data.partner_id,
        lines: lines.map((l) => ({
          variant_id: l.variant_id,
          quantity: l.quantity,
        })),
        destination_country_code: data.destination_country_code,
        destination_postal_code: data.destination_postal_code || null,
        destination_city: data.destination_city || null,
        currency_code: data.currency_code,
        region_id: data.region_id,
      } as any)
      assessed = result.readiness
      setReadiness(result.readiness)
    } catch {
      setReadiness(null)
    }

    if (assessed && !assessed.ready) {
      toast.error("This quote cannot be minted yet — see the reasons above.")
      setTab(Tab.QUANTITIES)
      return
    }

    mint({
      partner_id: data.partner_id,
      buyer_email: data.buyer_email,
      recipient_company: data.recipient_company || null,
      recipient_name: data.recipient_name || null,
      partner_note: data.partner_note || null,
      lines,
      destination_country_code: data.destination_country_code,
      destination_postal_code: data.destination_postal_code || null,
      destination_city: data.destination_city || null,
      currency_code: data.currency_code,
      region_id: data.region_id,
      ttl_days: data.ttl_days,
      // 🔑 `?? null`, never `|| null`: a 0% deposit is a real term and
      // `||` would send it as "unset", which the backend resolves to 30%.
      deposit_pct: data.deposit_pct ?? null,
      // #1439 S12 — freight the partner named, and why. Sent as a pair or
      // not at all; the amount without its basis is a number nobody can
      // account for later.
      freight_override_amount: data.freight_override_amount ?? null,
      freight_basis: data.freight_basis || null,
      // Omitted rather than sent empty — the backend's own default is the one
      // thing that should decide what "no choice" means.
      // Trimmed: the "type it yourself" branch starts empty, and a stray space
      // would be sent as a carrier id nothing can resolve — which fails as a
      // silent fallback to manual rates, not as an error.
      ...(data.carrier?.trim() ? { carrier: data.carrier.trim() } : {}),
      // The pair travels together or not at all (#1447).
      duties_prepaid: data.duties_prepaid ?? false,
      ...(data.duties_prepaid
        ? {
            // Rates, not money — the mint computes the amounts against the
            // basket it actually prices.
            duty_rate_percent: data.duty_rate_percent ?? null,
            import_tax_rate_percent: data.import_tax_rate_percent ?? null,
            ddp_fee_total: data.ddp_fee_total ?? null,
            duty_basis: data.duty_basis || null,
          }
        : {}),
    } as any)
  })

  if (minted) {
    return (
      <RouteFocusModal.Body className="flex-1 overflow-y-auto">
        <MintedPanel result={minted} />
      </RouteFocusModal.Body>
    )
  }

  return (
    <RouteFocusModal.Form form={form}>
      <ProgressTabs
        value={tab}
        onValueChange={(value) => handleChangeTab(value as Tab)}
        className="flex h-full flex-col overflow-hidden"
      >
        <KeyboundForm onSubmit={handleSubmit} className="flex h-full flex-col">
          <RouteFocusModal.Header>
            <div className="-my-2 w-full max-w-[720px] border-l">
              <ProgressTabs.List className="grid w-full grid-cols-4">
                <ProgressTabs.Trigger
                  status={tabState[Tab.PARTNER]}
                  value={Tab.PARTNER}
                >
                  Partner
                </ProgressTabs.Trigger>
                <ProgressTabs.Trigger
                  status={tabState[Tab.BUYER]}
                  value={Tab.BUYER}
                >
                  Buyer
                </ProgressTabs.Trigger>
                <ProgressTabs.Trigger
                  status={tabState[Tab.PRODUCTS]}
                  value={Tab.PRODUCTS}
                >
                  Products
                </ProgressTabs.Trigger>
                <ProgressTabs.Trigger
                  status={tabState[Tab.QUANTITIES]}
                  value={Tab.QUANTITIES}
                >
                  Quantities
                </ProgressTabs.Trigger>
              </ProgressTabs.List>
            </div>
          </RouteFocusModal.Header>

          {/*
            ⚠️ `overflow-hidden` here and `overflow-y-auto` on each tab's
            content, not the other way round: a FocusModal.Body does not scroll
            on its own, and the grid steps manage their own height.
          */}
          <RouteFocusModal.Body className="size-full overflow-hidden">
            <ProgressTabs.Content
              className="size-full overflow-y-auto p-16"
              value={Tab.PARTNER}
            >
              <div className="flex flex-col gap-y-8">
                <div className="flex flex-col gap-y-1">
                  <Heading level="h2">Partner</Heading>
                  <Text size="small" className="text-ui-fg-subtle">
                    Prices come from this partner's catalogue and freight from
                    their location. Variants outside their store are rejected —
                    that check is why this step comes first.
                  </Text>
                </div>

                <Form.Field
                  control={form.control}
                  name="partner_id"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>Partner</Form.Label>
                      <Form.Control>
                        <Select
                          value={field.value}
                          onValueChange={field.onChange}
                        >
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
              </div>
            </ProgressTabs.Content>

            <ProgressTabs.Content
              className="size-full overflow-y-auto p-16"
              value={Tab.BUYER}
            >
              <BuyerStep form={form} />
            </ProgressTabs.Content>

            <ProgressTabs.Content
              className="size-full overflow-y-auto"
              value={Tab.PRODUCTS}
            >
              <ProductsStep form={form} />
            </ProgressTabs.Content>

            <ProgressTabs.Content
              className="size-full overflow-hidden"
              value={Tab.QUANTITIES}
            >
              <div className="flex h-full flex-col overflow-y-auto">
                {readiness && (
                  <div className="px-6 pt-4 md:px-16">
                    <ReadinessPanel readiness={readiness} />
                  </div>
                )}
                <div className="px-6 pt-4 md:px-16">
                  <Text size="small" className="text-ui-fg-subtle">
                    Leave the trade-price fields blank to quote at the catalog
                    price. A unit price is read in the partner store's own
                    currency and converted at mint; a discount is a percentage
                    off the tier.
                  </Text>
                </div>
                <QuantitiesStep form={form} />
              </div>
            </ProgressTabs.Content>
          </RouteFocusModal.Body>

          <RouteFocusModal.Footer>
            <div className="flex items-center justify-end gap-x-2">
              <RouteFocusModal.Close asChild>
                <Button variant="secondary" size="small">
                  Cancel
                </Button>
              </RouteFocusModal.Close>
              {tab === Tab.QUANTITIES ? (
                <Button
                  key="submit"
                  type="submit"
                  variant="primary"
                  size="small"
                  isLoading={isPending || isChecking}
                >
                  Mint quote
                </Button>
              ) : (
                <Button
                  key="next"
                  type="button"
                  variant="primary"
                  size="small"
                  onClick={handleNextTab}
                >
                  Continue
                </Button>
              )}
            </div>
          </RouteFocusModal.Footer>
        </KeyboundForm>
      </ProgressTabs>
    </RouteFocusModal.Form>
  )
}
