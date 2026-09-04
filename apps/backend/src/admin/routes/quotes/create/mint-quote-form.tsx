import { zodResolver } from "@hookform/resolvers/zod"
import {
  Button,
  Container,
  Heading,
  Select,
  Text,
  toast,
} from "@medusajs/ui"
import { useRef, useState } from "react"
import { FieldPath, useForm } from "react-hook-form"

import { Form } from "../../../components/common/form"
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
 * ## Sections on a page, not steps in a modal
 *
 * This began as `RouteFocusModal.Form` + `ProgressTabs` — one step per
 * question, mirroring the partner wizard. At 2,420 lines across its steps that
 * had outgrown a modal: the operator could see exactly one answer at a time,
 * could not glance back at the basket while typing a destination, and every
 * mint navigated away from the list they started on.
 *
 * It is now the same four questions as SECTIONS down one page, in the layout of
 * the quote detail route this very form produces — `TwoColumnPage` with the
 * readiness verdict living in the sidebar rather than appearing, once, above a
 * grid. Draft orders are the shape being borrowed.
 *
 * 🔑 What deliberately did NOT change: the quote is still minted by a SINGLE
 * POST at the end. A draft order can persist section by section because its
 * prices are just the variant's; a quote's are computed — freight, tax, duty,
 * DDP, landed total — so a half-built quote row would be a quote with no price,
 * which is the one thing a quote exists to carry.
 *
 * Order still matters even without gates. The partner decides which catalogue
 * the variants come from and which location freight is quoted from, so it leads
 * — pick products first and you build a basket that is then rejected wholesale.
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

/** The sections, in the order the page lays them out. */
const SECTIONS = ["partner", "buyer", "products", "quantities"] as const
type SectionId = (typeof SECTIONS)[number]

export const MintQuoteForm = () => {
  /**
   * Scroll targets. With every section on the page, "you cannot mint yet"
   * has somewhere to point — the refusal moves the page to the section that
   * caused it instead of naming a step the operator must go and find.
   */
  const sectionRefs = useRef<Record<SectionId, HTMLDivElement | null>>({
    partner: null,
    buyer: null,
    products: null,
    quantities: null,
  })

  const goToSection = (id: SectionId) =>
    sectionRefs.current[id]?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    })
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
      buyer_tax_id: "",
      buyer_tax_id_type: "",
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
      design_by_variant: {},
      weights: {},
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
        // #1486 — alongside the variant, never instead of it.
        const designId = data.design_by_variant?.[variant_id]
        // Blank stays blank. See `weights` in schema.ts — a 0 here is a
        // weightless consignment, not "unknown".
        const weight = data.weights?.[variant_id]
        return {
          variant_id,
          quantity: qty as number,
          position: index,
          ...(typeof weight === "number" && weight > 0
            ? { unit_weight_grams: weight }
            : {}),
          ...(designId ? { design_id: designId } : {}),
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
      goToSection("quantities")
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
          // Or the preflight refuses a basket the mint would have priced.
          ...(l.unit_weight_grams
            ? { unit_weight_grams: l.unit_weight_grams }
            : {}),
          /**
           * 🔴 Dropped here until now, and the mint sent it. A made-to-order
           * design product is put in the partner's catalogue BY THE MINT, and
           * the assessor can only know that if it knows the line came from a
           * design — so without this the preflight refused, as
           * `variant_not_in_catalogue`, every basket the mint would have
           * accepted. The two calls have to describe the same basket.
           */
          ...(l.design_id ? { design_id: l.design_id } : {}),
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
      goToSection("quantities")
      return
    }

    mint({
      partner_id: data.partner_id,
      buyer_email: data.buyer_email,
      recipient_company: data.recipient_company || null,
      // Empty means "none given", never an empty registration.
      buyer_tax_id: data.buyer_tax_id?.trim() || null,
      buyer_tax_id_type: data.buyer_tax_id_type?.trim() || null,
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

  /**
   * 🔴 A successful mint swaps the page for the panel and does NOT navigate.
   *
   * The raw token is returned by the API exactly once — only its sha256 is
   * stored — so the panel holds the ONLY copy of the buyer's link. Every other
   * create route calls `handleSuccess` here; doing that would discard the link
   * and force a re-mint.
   */
  if (minted) {
    return (
      <div className="flex w-full flex-col gap-y-3">
        <MintedPanel result={minted} />
      </div>
    )
  }

  /**
   * A section is a container plus a scroll target — NOT a heading.
   *
   * 🔴 Wrapping each step in a titled header rendered "Buyer" twice and put
   * "Items" directly above the step's own "Products": `BuyerStep`,
   * `ProductsStep` and the rest were written for a modal that supplied no
   * chrome, so they carry their own headings — and `BuyerStep` in fact carries
   * THREE (Buyer, Freight source, Import duty). Only a render showed it; every
   * test passed with the duplicate on screen.
   *
   * So the step owns its heading, and `title` is passed only where the body is
   * inline JSX with no heading of its own.
   */
  const section = (
    id: SectionId,
    body: React.ReactNode,
    header?: { title: string; description: string },
    /**
     * Whether the body needs the container's own inset.
     *
     * The steps were written as modal tabs: the form ones were given `p-16` by
     * the tab that held them and so carry no padding of their own, while the
     * table ones were deliberately full-bleed. Dropped into a `Container`
     * unchanged, the form steps sat flush against the edge while the sections
     * around them were inset — visible immediately on screen, invisible to
     * every test.
     */
    padded = false
  ) => (
    <Container className={header ? "divide-y p-0" : "p-0"}>
      <div
        ref={(el) => {
          sectionRefs.current[id] = el
        }}
      >
        {header && (
          <div className="px-6 py-4">
            <Heading level="h2">{header.title}</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              {header.description}
            </Text>
          </div>
        )}
      </div>
      <div className={header || padded ? "px-6 py-4" : ""}>{body}</div>
    </Container>
  )

  return (
    <Form {...form}>
      <KeyboundForm onSubmit={handleSubmit} className="flex w-full flex-col">
        <div className="flex flex-col gap-x-4 gap-y-3 xl:flex-row xl:items-start">
          {/* ---- main column: the four questions, all visible ---- */}
          <div className="flex w-full flex-col gap-y-3">
            {section(
              "partner",
              <Form.Field
                control={form.control}
                name="partner_id"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>Partner</Form.Label>
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
              />,
              {
                title: "Partner",
                description:
                  "Prices come from this partner's catalogue and freight from their location. Variants outside their store are rejected — which is why this comes first.",
              }
            )}

            {section("buyer", <BuyerStep form={form} />, undefined, true)}

            {section("products", <ProductsStep form={form} />)}

            {section("quantities", <QuantitiesStep form={form} />, {
              title: "Quantities & pricing",
              description:
                "Leave the trade-price fields blank to quote at the catalog price. A unit price is read in the partner store's own currency and converted at mint; a discount is a percentage off the tier.",
            })}
          </div>

          {/* ---- sidebar: the verdict, and the one button that mints ---- */}
          <div className="flex w-full flex-col gap-y-3 xl:sticky xl:top-0 xl:max-w-[400px]">
            <Container className="divide-y p-0">
              <div className="px-6 py-4">
                <Heading level="h2">Mint</Heading>
                <Text size="small" className="text-ui-fg-subtle">
                  Every line is priced and a carrier is asked for a rate before
                  the quote is minted.
                </Text>
              </div>
              <div className="flex items-center justify-end gap-x-2 px-6 py-4">
                <Button
                  type="submit"
                  variant="primary"
                  size="small"
                  isLoading={isPending || isChecking}
                >
                  Mint quote
                </Button>
              </div>
            </Container>

            {/*
              The readiness verdict lives here rather than above the grid, so a
              refusal stays on screen while the operator fixes the line that
              caused it.
            */}
            {readiness && (
              <Container className="p-0">
                <div className="px-6 py-4">
                  <ReadinessPanel readiness={readiness} />
                </div>
              </Container>
            )}
          </div>
        </div>
      </KeyboundForm>
    </Form>
  )
}
