import { zodResolver } from "@hookform/resolvers/zod"
import { PencilSquare, Trash } from "@medusajs/icons"
import {
  Badge,
  Button,
  Container,
  Drawer,
  Heading,
  Text,
  toast,
} from "@medusajs/ui"
import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { useNavigate } from "react-router-dom"

import { ActionMenu } from "../../../../components/common/action-menu"
import { Form } from "../../../../components/common/form"
import { TwoColumnPage } from "../../../../components/pages/two-column-pages"
import {
  AdminQuoteDraft,
  QuoteReadiness,
  useAdminQuoteReadiness,
  useDeleteQuoteDraft,
  useMintQuoteDraft,
  useUpdateQuoteDraft,
} from "../../../../hooks/api/quotes"
import { MintedPanel, type MintedQuoteResult } from "../../create/minted-panel"
import { ReadinessPanel } from "../../create/readiness-panel"
import {
  AdminQuoteCreateSchema,
  AdminQuoteCreateSchemaType,
} from "../../create/schema"
import { BuyerStep } from "../../create/steps/buyer-step"
import { ProductsStep } from "../../create/steps/products-step"
import { QuantitiesStep } from "../../create/steps/quantities-step"

/**
 * A draft quote's page (#1446) — the draft ORDER detail page, mirrored.
 *
 * ## Read the record; edit in a drawer
 *
 * The first attempt put every editing form on the page at once, each with its
 * own "Save section" button. That is not what a draft order looks like: its
 * page is a READ-ONLY record — a summary of items and totals, a customer card,
 * an activity feed — and every edit is reached through the `…` menu on the card
 * that owns it. One primary action sits in the summary's footer, and for a
 * draft order that action is "Convert to order".
 *
 * So: same two-column layout, same `…` menus, and **Mint quote** exactly where
 * "Convert to order" lives. A quote is minted rather than converted, but it is
 * the same move — the thing stops being a draft and becomes the real record.
 *
 * ## The form still exists, it is just not on the page
 *
 * One `react-hook-form` instance backs every drawer, because the steps are
 * written against the whole quote schema and share fields — the buyer drawer's
 * region decides which countries the items were priced for. Each drawer saves
 * only the fields it owns, so opening one cannot overwrite another's work.
 */

/** Which draft columns each drawer is allowed to write. */
const BUYER_FIELDS = [
  "region_id",
  "currency_code",
  "destination_country_code",
  "destination_postal_code",
  "destination_city",
  "buyer_email",
  "recipient_name",
  "recipient_company",
  "buyer_tax_id",
  "buyer_tax_id_type",
  "partner_note",
  "deposit_pct",
  "duties_prepaid",
  "duty_rate_percent",
  "import_tax_rate_percent",
  "ddp_fee_total",
  "duty_basis",
] as const

const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="grid grid-cols-2 items-center px-6 py-4">
    <Text size="small" weight="plus" className="text-ui-fg-subtle">
      {label}
    </Text>
    <Text size="small">{value || "-"}</Text>
  </div>
)

export const DraftSections = ({ draft }: { draft: AdminQuoteDraft }) => {
  const navigate = useNavigate()
  const [minted, setMinted] = useState<MintedQuoteResult | null>(null)
  const [readiness, setReadiness] = useState<QuoteReadiness | null>(null)
  const [drawer, setDrawer] = useState<null | "buyer" | "shipping">(null)

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
      carrier: "",
      product_ids: [],
      quantities: {},
      discounts: {},
      overrides: {},
      design_by_variant: {},
      weights: {},
      duties_prepaid: false,
      duty_rate_percent: null,
      import_tax_rate_percent: null,
      ddp_fee_total: null,
      duty_basis: null,
    },
    resolver: zodResolver(AdminQuoteCreateSchema) as any,
  })

  /**
   * Hydrate from the row.
   *
   * 🔴 `?? ""` on text and `?? null` on numbers. Handing a null column to a
   * controlled input makes React swap it to an uncontrolled one mid-life, and
   * the field silently stops tracking the form.
   */
  useEffect(() => {
    if (!draft) return
    const quantities: Record<string, number> = {}
    const designByVariant: Record<string, string> = {}
    const productIds: string[] = []

    for (const line of draft.lines ?? []) {
      quantities[line.variant_id] = line.quantity
      if (line.design_id) designByVariant[line.variant_id] = line.design_id
      if (line.product_id && !productIds.includes(line.product_id)) {
        productIds.push(line.product_id)
      }
    }

    form.reset({
      ...form.getValues(),
      partner_id: draft.partner_id ?? "",
      region_id: (draft as any).region_id ?? "",
      currency_code: draft.currency_code ?? "",
      destination_country_code: (draft as any).destination_country_code ?? "",
      destination_postal_code: (draft as any).destination_postal_code ?? "",
      destination_city: (draft as any).destination_city ?? "",
      buyer_email: (draft as any).email_sent_to ?? "",
      recipient_name: (draft as any).recipient_name ?? "",
      recipient_company: (draft as any).recipient_company ?? "",
      buyer_tax_id: (draft as any).buyer_tax_id ?? "",
      buyer_tax_id_type: (draft as any).buyer_tax_id_type ?? "",
      partner_note: (draft as any).partner_note ?? "",
      // 🔑 `??`, never `||`: a stored 0% deposit is a real commercial term.
      deposit_pct: (draft as any).deposit_pct ?? null,
      duties_prepaid: (draft as any).duties_prepaid ?? false,
      product_ids: productIds,
      quantities,
      design_by_variant: designByVariant,
    } as any)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.id])

  const { mutate: save, isPending: isSaving } = useUpdateQuoteDraft(draft.id, {
    onSuccess: () => {
      toast.success("Saved.")
      setDrawer(null)
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not save."),
  })

  const { mutate: destroy } = useDeleteQuoteDraft(draft.id, {
    onSuccess: () => {
      toast.success("Draft discarded.")
      navigate("/quotes")
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not discard."),
  })

  const { mutate: mintDraft, isPending: isMinting } = useMintQuoteDraft(
    draft.id,
    {
      onSuccess: (data: any) => setMinted(data as MintedQuoteResult),
      onError: (e: any) => toast.error(e?.message ?? "Could not mint this quote."),
    }
  )

  const { mutateAsync: checkReadiness, isPending: isChecking } =
    useAdminQuoteReadiness()

  /** The basket as the grid currently holds it. */
  const currentLines = () => {
    const data = form.getValues()
    return Object.entries(data.quantities ?? {})
      .filter(([, qty]) => typeof qty === "number" && qty > 0)
      .map(([variant_id, quantity], index) => ({
        variant_id,
        quantity: quantity as number,
        position: index,
        ...(data.design_by_variant?.[variant_id]
          ? { design_id: data.design_by_variant[variant_id] }
          : {}),
      }))
  }

  const saveBuyer = () => {
    const data = form.getValues() as any
    const payload: Record<string, unknown> = {}
    for (const key of BUYER_FIELDS) {
      const value = data[key]
      // Blank text means "not given" — never an empty string in the column.
      payload[key] = value === "" ? null : value
    }
    // 🔑 No `lines` key at all. Absence is what stops this drawer emptying the
    // basket the items drawer owns.
    save(payload)
  }

  const handleMint = async () => {
    const lines = currentLines()
    if (!lines.length) {
      toast.error(
        "Add at least one item — a quote with no lines has nothing to price."
      )
      navigate(`/quotes/drafts/${draft.id}/items`)
      return
    }

    /**
     * The basket is saved before it is priced. The mint reads the DRAFT, not
     * this form, so an unsaved grid would be minted at whatever was last
     * stored — quietly, and at the wrong quantities.
     */
    await new Promise<void>((resolve) =>
      save({ lines }, { onSuccess: () => resolve(), onError: () => resolve() })
    )

    /**
     * 🔑 A preflight that cannot RUN does not block the mint — the workflow
     * runs the same assessor as its first step, so the real gate is there
     * either way, and failing closed here would turn a network blip into "you
     * cannot quote".
     */
    let assessed: QuoteReadiness | null = null
    try {
      const data = form.getValues()
      const result = await checkReadiness({
        partner_id: data.partner_id,
        lines: lines.map((l) => ({
          variant_id: l.variant_id,
          quantity: l.quantity,
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
      toast.error("This quote cannot be minted yet — see the reasons beside it.")
      return
    }

    mintDraft()
  }

  /**
   * 🔴 A successful mint swaps the page for the panel and does NOT navigate.
   *
   * The raw token is returned exactly once — only its sha256 is stored — so
   * this panel holds the ONLY copy of the buyer's link.
   */
  if (minted) {
    return (
      <div className="flex w-full flex-col gap-y-3">
        <MintedPanel result={minted} />
      </div>
    )
  }

  const lines = draft.lines ?? []
  const totalUnits = lines.reduce((sum, l) => sum + (l.quantity ?? 0), 0)
  const currency = String(draft.currency_code || "").toUpperCase()

  return (
    <Form {...form}>
      <TwoColumnPage widgets={{ before: [], after: [], sideBefore: [], sideAfter: [] }}>
        <TwoColumnPage.Main>
          {/* ---- identity ---- */}
          <Container className="flex items-start justify-between p-6">
            <div>
              <div className="flex items-center gap-x-2">
                <Heading>Draft quote</Heading>
                {currency && <Badge size="2xsmall">{currency}</Badge>}
                <Badge size="2xsmall" color="orange">
                  Draft
                </Badge>
              </div>
              <Text size="small" className="text-ui-fg-subtle">
                Nothing is priced until you mint. Prices are frozen at that
                moment, and the buyer's link is issued once.
              </Text>
            </div>
            <ActionMenu
              groups={[
                {
                  actions: [
                    {
                      icon: <Trash />,
                      label: "Discard draft",
                      onClick: () => destroy(),
                    },
                  ],
                },
              ]}
            />
          </Container>

          {/* ---- summary: the items, and the one action ---- */}
          <Container className="divide-y p-0">
            <div className="flex items-center justify-between px-6 py-4">
              <Heading level="h2">Summary</Heading>
              <ActionMenu
                groups={[
                  {
                    actions: [
                      {
                        icon: <PencilSquare />,
                        label: "Edit items",
                        /**
                         * A ROUTE, not a drawer. The basket is a full DataGrid
                         * and a side drawer gave it a third of the screen — the
                         * product table was already clipping its own cells at
                         * that width. It also gets the per-line design picker a
                         * `StackedModalProvider`, which is what lets that panel
                         * stack over the grid it annotates.
                         */
                        to: `/quotes/drafts/${draft.id}/items`,
                      },
                    ],
                  },
                ]}
              />
            </div>

            {lines.length ? (
              lines.map((l) => (
                <div
                  key={l.id}
                  className="grid grid-cols-[1fr_auto] items-center gap-x-4 px-6 py-3"
                >
                  <Text size="small">{l.variant_id}</Text>
                  <Text size="small" className="text-ui-fg-subtle">
                    {l.quantity}×
                  </Text>
                </div>
              ))
            ) : (
              <div className="px-6 py-6">
                <Text size="small" className="text-ui-fg-subtle">
                  No items yet. A quote with no lines has nothing to price.
                </Text>
              </div>
            )}

            <div className="grid grid-cols-2 px-6 py-4">
              <Text size="small" weight="plus">
                Units
              </Text>
              <Text size="small" className="text-right">
                {totalUnits}
              </Text>
            </div>

            {/*
              Exactly where a draft order puts "Convert to order". A quote is
              minted rather than converted, but it is the same move: the thing
              stops being a draft and becomes the record.
            */}
            <div className="bg-ui-bg-subtle flex justify-end px-6 py-4">
              <Button
                variant="secondary"
                size="small"
                isLoading={isMinting || isChecking || isSaving}
                onClick={handleMint}
              >
                Mint quote
              </Button>
            </div>
          </Container>

          {/*
            Shipping, as its own card (#1446).
            
            A draft order has one, and its position is the point: you settle the
            customer, add items, and only THEN add shipping — because the lane
            is quoted against the basket's weight, so it cannot be answered
            before the basket exists. It used to be buried in the middle of the
            buyer form, asked before there was anything to ship.
          */}
          <Container className="divide-y p-0">
            <div className="flex items-center justify-between px-6 py-4">
              <Heading level="h2">Shipping</Heading>
              <ActionMenu
                groups={[
                  {
                    actions: [
                      {
                        icon: <PencilSquare />,
                        label: "Edit shipping & duty",
                        onClick: () => setDrawer("shipping"),
                      },
                    ],
                  },
                ]}
              />
            </div>
            <Row
              label="Rate source"
              value={
                (draft as any).quoted_freight_source ||
                "Platform default — a carrier is asked at mint"
              }
            />
            <Row
              label="Duty"
              value={
                (draft as any).duties_prepaid
                  ? "We pay the import duty (DDP)"
                  : "Buyer is importer of record"
              }
            />
            {!lines.length && (
              <div className="px-6 py-4">
                <Text size="small" className="text-ui-fg-subtle">
                  The lane is quoted against the basket's weight, so add items
                  first — a rate asked now would be a rate for nothing.
                </Text>
              </div>
            )}
          </Container>

          {readiness && (
            <Container className="p-0">
              <div className="px-6 py-4">
                <ReadinessPanel readiness={readiness} />
              </div>
            </Container>
          )}
        </TwoColumnPage.Main>

        <TwoColumnPage.Sidebar>
          {/* ---- the buyer card, where a draft order puts Customer ---- */}
          <Container className="divide-y p-0">
            <div className="flex items-center justify-between px-6 py-4">
              <Heading level="h2">Buyer</Heading>
              <ActionMenu
                groups={[
                  {
                    actions: [
                      {
                        icon: <PencilSquare />,
                        label: "Edit buyer & terms",
                        onClick: () => setDrawer("buyer"),
                      },
                    ],
                  },
                ]}
              />
            </div>
            <Row label="Email" value={(draft as any).email_sent_to} />
            <Row label="Company" value={(draft as any).recipient_company} />
            <Row label="Contact" value={(draft as any).recipient_name} />
            <Row
              label="Ships to"
              value={[
                (draft as any).destination_city,
                String((draft as any).destination_country_code || "").toUpperCase(),
              ]
                .filter(Boolean)
                .join(", ")}
            />
            <Row
              label="Deposit"
              value={
                // 🔑 `!= null`, not truthiness: 0% is a real term and would
                // otherwise render as the platform default.
                (draft as any).deposit_pct != null
                  ? `${(draft as any).deposit_pct}%`
                  : "Platform default"
              }
            />
          </Container>
        </TwoColumnPage.Sidebar>
      </TwoColumnPage>

      {/* ---- editing happens here, not on the page ---- */}
      <Drawer
        open={drawer === "shipping"}
        onOpenChange={(o) => !o && setDrawer(null)}
      >
        <Drawer.Content>
          <Drawer.Header>
            <Drawer.Title>Shipping & duty</Drawer.Title>
          </Drawer.Header>
          <Drawer.Body className="overflow-y-auto">
            <BuyerStep form={form} only="shipping" />
          </Drawer.Body>
          <Drawer.Footer>
            <Drawer.Close asChild>
              <Button variant="secondary" size="small">
                Cancel
              </Button>
            </Drawer.Close>
            {/*
              The same field list as the buyer drawer: both write columns the
              draft owns, and `saveBuyer` sends no `lines` key — which is what
              stops either of them emptying the basket.
            */}
            <Button size="small" isLoading={isSaving} onClick={saveBuyer}>
              Save
            </Button>
          </Drawer.Footer>
        </Drawer.Content>
      </Drawer>

      <Drawer open={drawer === "buyer"} onOpenChange={(o) => !o && setDrawer(null)}>
        <Drawer.Content>
          <Drawer.Header>
            <Drawer.Title>Buyer & terms</Drawer.Title>
          </Drawer.Header>
          <Drawer.Body className="overflow-y-auto">
            <BuyerStep form={form} only="buyer" />
          </Drawer.Body>
          <Drawer.Footer>
            <Drawer.Close asChild>
              <Button variant="secondary" size="small">
                Cancel
              </Button>
            </Drawer.Close>
            <Button size="small" isLoading={isSaving} onClick={saveBuyer}>
              Save
            </Button>
          </Drawer.Footer>
        </Drawer.Content>
      </Drawer>

    </Form>
  )
}
