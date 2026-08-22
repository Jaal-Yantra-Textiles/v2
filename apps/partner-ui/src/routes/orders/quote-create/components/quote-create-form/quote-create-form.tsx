import { zodResolver } from "@hookform/resolvers/zod"
import { Button, ProgressStatus, ProgressTabs, toast } from "@medusajs/ui"
import { useState } from "react"
import { FieldPath, useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { z } from "@medusajs/framework/zod"

import {
  RouteFocusModal,
  useRouteModal,
} from "../../../../../components/modals"
import { KeyboundForm } from "../../../../../components/utilities/keybound-form"
import { useDocumentDirection } from "../../../../../hooks/use-document-direction"
import {
  MintPartnerQuoteResponse,
  QuoteReadiness,
  useMintPartnerQuote,
  useQuoteReadiness,
} from "../../../../../hooks/api/partner-quotes"
import { QuoteBuyerForm } from "./quote-buyer-form"
import { QuoteMintedPanel } from "./quote-minted-panel"
import { QuoteProductsForm } from "./quote-products-form"
import { QuoteQuantitiesForm } from "./quote-quantities-form"
import { QuoteReadinessPanel } from "./quote-readiness-panel"
import {
  QuoteBuyerFields,
  QuoteBuyerSchema,
  QuoteCreateSchema,
  QuoteCreateSchemaType,
  QuoteProductFields,
  QuoteProductsSchema,
} from "./schema"

enum Tab {
  BUYER = "buyer",
  PRODUCT = "product",
  QUANTITY = "quantity",
}

const tabOrder = [Tab.BUYER, Tab.PRODUCT, Tab.QUANTITY] as const

type TabState = Record<Tab, ProgressStatus>

const initialTabState: TabState = {
  [Tab.BUYER]: "in-progress",
  [Tab.PRODUCT]: "not-started",
  [Tab.QUANTITY]: "not-started",
}

type QuoteCreateFormProps = {
  currencies: string[]
  defaultCurrency?: string
}

export const QuoteCreateForm = ({
  currencies,
  defaultCurrency,
}: QuoteCreateFormProps) => {
  const [tab, setTab] = useState<Tab>(Tab.BUYER)
  const [tabState, setTabState] = useState<TabState>(initialTabState)

  /**
   * 🔴 The minted token is returned by the API ONCE and never again — only its
   * sha256 is stored. So a successful mint does NOT navigate away: it swaps the
   * modal body for the panel holding the only copy of the link. Calling
   * `handleSuccess` here, the way every other create flow does, would discard
   * the buyer's link and force a re-mint.
   */
  const [minted, setMinted] = useState<MintPartnerQuoteResponse | null>(null)

  const { t } = useTranslation()
  const direction = useDocumentDirection()

  const form = useForm<QuoteCreateSchemaType>({
    defaultValues: {
      buyer_email: "",
      recipient_name: "",
      recipient_company: "",
      partner_note: "",
      destination_country_code: "in",
      destination_postal_code: "",
      destination_city: "",
      currency_code: defaultCurrency ?? currencies[0] ?? "inr",
      ttl_days: 14,
      product_ids: [],
      quantities: {},
      discounts: {},
      overrides: {},
      // Never defaulted on: a DDP promise applied by default would tell a buyer
      // there is nothing to pay on a shipment nobody arranged clearance for.
      duties_prepaid: false,
      duty_rate_percent: null,
      import_tax_rate_percent: null,
      ddp_fee_total: null,
      duty_basis: null,
    },
    resolver: zodResolver(QuoteCreateSchema),
  })

  const { mutateAsync, isPending } = useMintPartnerQuote()

  /**
   * #1445 — the preflight. Run on submit rather than on every quantity change:
   * it prices every line and asks a carrier, which is not a thing to fire per
   * keystroke. The mint runs the same assessor server-side, so this changes
   * what the partner SEES, never what the platform accepts.
   */
  const { mutateAsync: checkReadiness, isPending: isChecking } =
    useQuoteReadiness()
  const [readiness, setReadiness] = useState<QuoteReadiness | null>(null)

  const handleSubmit = form.handleSubmit(async (data) => {
    /**
     * A blank or zero quantity means "not in this basket" — it is dropped, not
     * sent as a zero. The backend holds the same line one level down: a line
     * whose amount will not resolve is dropped rather than zeroed, because a
     * zero would mint an ACTIVE price of zero that the cart would honour.
     */
    const lines = Object.entries(data.quantities ?? {})
      .filter(([, qty]) => typeof qty === "number" && qty > 0)
      .map(([variant_id, qty], index) => {
        /**
         * A blank override cell is "no override", never a zero (#1446). Sent
         * as 0 it would ask the backend to mint an ACTIVE price of zero — it
         * refuses, but the refusal would arrive as a failed mint rather than
         * as the no-op the partner intended. Dropped here, and only a real
         * positive number is sent.
         */
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
        t(
          "quotes.create.noLines",
          "Set a quantity on at least one variant — a quote with no lines has nothing to price."
        )
      )
      setTab(Tab.QUANTITY)
      return
    }

    // Preflight before anything is created. A basket that cannot be shipped or
    // priced is refused HERE, with every reason named at once, rather than
    // minting a confident wrong number the way #1424/#1430/#1434 all did.
    let assessed: QuoteReadiness | null = null
    try {
      const result = await checkReadiness({
        lines: lines.map((l) => ({
          variant_id: l.variant_id,
          quantity: l.quantity,
        })),
        destination_country_code: data.destination_country_code,
        destination_postal_code: data.destination_postal_code || null,
        destination_city: data.destination_city || null,
        currency_code: data.currency_code,
      })
      assessed = result.readiness
      setReadiness(result.readiness)
    } catch {
      // 🔑 A preflight that cannot run must not block the mint. The workflow
      // runs the same assessor as its first step, so the real gate is still
      // there — failing closed here would turn an unrelated network blip into
      // "you cannot quote".
      setReadiness(null)
    }

    if (assessed && !assessed.ready) {
      toast.error(
        t(
          "quotes.create.readiness.blockedToast",
          "This quote cannot be minted yet — see the reasons above."
        )
      )
      setTab(Tab.QUANTITY)
      return
    }

    await mutateAsync(
      {
        buyer_email: data.buyer_email,
        recipient_name: data.recipient_name || null,
        recipient_company: data.recipient_company || null,
        partner_note: data.partner_note || null,
        lines,
        destination_country_code: data.destination_country_code,
        destination_postal_code: data.destination_postal_code || null,
        destination_city: data.destination_city || null,
        currency_code: data.currency_code,
        ttl_days: data.ttl_days,
        // Sent as a pair or not at all — the backend refuses the promise
        // without its number, and the number without the promise (#1447).
        duties_prepaid: data.duties_prepaid ?? false,
        ...(data.duties_prepaid
          ? {
              // Rates, not money: the mint computes the amounts against the
              // basket it actually prices. This form knows neither the tiered
              // subtotal nor the freight until then.
              duty_rate_percent: data.duty_rate_percent ?? null,
              import_tax_rate_percent: data.import_tax_rate_percent ?? null,
              ddp_fee_total: data.ddp_fee_total ?? null,
              duty_basis: data.duty_basis || null,
            }
          : {}),
      },
      {
        onSuccess: (result) => {
          toast.success(
            t("quotes.create.successToast", "Quote minted — copy the link.")
          )
          setMinted(result)
        },
        onError: (error) => {
          toast.error(error.message)
        },
      }
    )
  })

  const partialFormValidation = (
    fields: readonly FieldPath<QuoteCreateSchemaType>[],
    schema: z.ZodSchema<any>
  ) => {
    form.clearErrors(fields as FieldPath<QuoteCreateSchemaType>[])

    const values = fields.reduce(
      (acc, key) => {
        acc[key] = form.getValues(key)
        return acc
      },
      {} as Record<string, unknown>
    )

    const validationResult = schema.safeParse(values)

    if (!validationResult.success) {
      validationResult.error.issues.forEach(({ path, message, code }) => {
        form.setError(path.join(".") as keyof QuoteCreateSchemaType, {
          type: code,
          message,
        })
      })
      return false
    }

    return true
  }

  const handleChangeTab = (update: Tab) => {
    if (tab === update) {
      return
    }

    if (tabOrder.indexOf(update) < tabOrder.indexOf(tab)) {
      setTabState((prev) => ({
        ...prev,
        [update]: "in-progress",
      }))
      setTab(update)
      return
    }

    const tabs = tabOrder.slice(0, tabOrder.indexOf(update))

    for (const current of tabs) {
      if (current === Tab.BUYER) {
        if (!partialFormValidation(QuoteBuyerFields, QuoteBuyerSchema)) {
          setTabState((prev) => ({ ...prev, [current]: "in-progress" }))
          setTab(current)
          return
        }
        setTabState((prev) => ({ ...prev, [current]: "completed" }))
      } else if (current === Tab.PRODUCT) {
        if (!partialFormValidation(QuoteProductFields, QuoteProductsSchema)) {
          setTabState((prev) => ({ ...prev, [current]: "in-progress" }))
          setTab(current)
          return
        }
        if (!form.getValues("product_ids").length) {
          toast.error(
            t("quotes.create.noProducts", "Pick at least one product.")
          )
          setTab(current)
          return
        }
        setTabState((prev) => ({ ...prev, [current]: "completed" }))
      }
    }

    setTabState((prev) => ({ ...prev, [update]: "in-progress" }))
    setTab(update)
  }

  const handleNextTab = () => {
    if (tab === tabOrder[tabOrder.length - 1]) {
      return
    }
    handleChangeTab(tabOrder[tabOrder.indexOf(tab) + 1])
  }

  if (minted) {
    return <QuoteMintedPanel result={minted} />
  }

  return (
    <RouteFocusModal.Form form={form}>
      <ProgressTabs
        dir={direction}
        value={tab}
        onValueChange={(value) => handleChangeTab(value as Tab)}
        className="flex h-full flex-col overflow-hidden"
      >
        <KeyboundForm onSubmit={handleSubmit} className="flex h-full flex-col">
          <RouteFocusModal.Header>
            <div className="flex w-full items-center justify-between gap-x-4">
              <div className="-my-2 w-full max-w-[600px] border-l">
                <ProgressTabs.List className="grid w-full grid-cols-3">
                  <ProgressTabs.Trigger
                    status={tabState[Tab.BUYER]}
                    value={Tab.BUYER}
                  >
                    {t("quotes.create.tabs.buyer", "Buyer")}
                  </ProgressTabs.Trigger>
                  <ProgressTabs.Trigger
                    status={tabState[Tab.PRODUCT]}
                    value={Tab.PRODUCT}
                  >
                    {t("quotes.create.tabs.products", "Products")}
                  </ProgressTabs.Trigger>
                  <ProgressTabs.Trigger
                    status={tabState[Tab.QUANTITY]}
                    value={Tab.QUANTITY}
                  >
                    {t("quotes.create.tabs.quantities", "Quantities")}
                  </ProgressTabs.Trigger>
                </ProgressTabs.List>
              </div>
            </div>
          </RouteFocusModal.Header>
          <RouteFocusModal.Body className="size-full overflow-hidden">
            <ProgressTabs.Content
              className="size-full overflow-y-auto p-16"
              value={Tab.BUYER}
            >
              <QuoteBuyerForm form={form} currencies={currencies} />
            </ProgressTabs.Content>
            <ProgressTabs.Content
              className="size-full overflow-y-auto"
              value={Tab.PRODUCT}
            >
              <QuoteProductsForm form={form} />
            </ProgressTabs.Content>
            <ProgressTabs.Content
              className="size-full overflow-hidden"
              value={Tab.QUANTITY}
            >
              <div className="flex h-full flex-col overflow-y-auto">
                {readiness && (
                  <div className="px-6 pt-4 md:px-16">
                    <QuoteReadinessPanel readiness={readiness} />
                  </div>
                )}
                <QuoteQuantitiesForm form={form} />
              </div>
            </ProgressTabs.Content>
          </RouteFocusModal.Body>
          <RouteFocusModal.Footer>
            <div className="flex items-center justify-end gap-x-2">
              <RouteFocusModal.Close asChild>
                <Button variant="secondary" size="small">
                  {t("actions.cancel", "Cancel")}
                </Button>
              </RouteFocusModal.Close>
              {tab === Tab.QUANTITY ? (
                <Button
                  key="submit"
                  type="submit"
                  variant="primary"
                  size="small"
                  isLoading={isPending || isChecking}
                >
                  {t("quotes.create.mint", "Mint quote")}
                </Button>
              ) : (
                <Button
                  key="next"
                  type="button"
                  variant="primary"
                  size="small"
                  onClick={handleNextTab}
                >
                  {t("actions.continue", "Continue")}
                </Button>
              )}
            </div>
          </RouteFocusModal.Footer>
        </KeyboundForm>
      </ProgressTabs>
    </RouteFocusModal.Form>
  )
}
