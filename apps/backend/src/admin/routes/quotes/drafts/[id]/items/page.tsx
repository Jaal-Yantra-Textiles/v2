import { zodResolver } from "@hookform/resolvers/zod"
import { Button, Heading, ProgressTabs, Text, toast } from "@medusajs/ui"
import { useEffect, useMemo, useState } from "react"
import { useForm, useWatch } from "react-hook-form"
import { useParams } from "react-router-dom"

import { Form } from "../../../../../components/common/form"
import { RouteFocusModal } from "../../../../../components/modal/route-focus-modal"
import { StackedFocusModal } from "../../../../../components/modal/stacked-modal/stacked-focused-modal"
import { useRouteModal } from "../../../../../components/modal/use-route-modal"
import { TwoColumnPageSkeleton } from "../../../../../components/table/skeleton"
import { KeyboundForm } from "../../../../../components/utilitites/key-bound-form"
import { useProducts } from "../../../../../hooks/api/products"
import {
  useQuoteDraft,
  useUpdateQuoteDraft,
} from "../../../../../hooks/api/quotes"
import { BulkDiscountPanel } from "../../../create/bulk-discount-panel"
import {
  basketFromDraftLines,
  conflictingOverrides,
  draftLinesFromForm,
} from "../../../create/draft-lines"
import { AdminLineDesignsPanel } from "../../../create/line-designs-panel"
import {
  AdminQuoteCreateSchema,
  AdminQuoteCreateSchemaType,
} from "../../../create/schema"
import { ProductsStep } from "../../../create/steps/products-step"
import { QuantitiesStep } from "../../../create/steps/quantities-step"

const DESIGNS_MODAL_ID = "quote-draft-line-designs"

/**
 * Picking WHAT, then saying HOW MANY — two steps, not one scroll.
 *
 * Both are full-width tables. Stacked vertically the operator picked products
 * at the top, scrolled past the whole catalogue page, and met a quantities grid
 * for rows they could no longer see. Worse, the grid renders a row per variant
 * of every SELECTED product, so before anything is ticked it is simply empty —
 * a second table showing nothing, under a first table showing everything.
 *
 * As steps each one owns the modal while it is being answered, and the second
 * cannot be reached before the first has an answer to give it.
 */
enum ItemsTab {
  PRODUCTS = "products",
  QUANTITIES = "quantities",
  DISCOUNT = "discount",
}

/**
 * Editing a draft's items (#1446).
 *
 * ## Why a focus modal and not the drawer it started as
 *
 * The basket is a full DataGrid — product rows, variant sub-rows, quantity,
 * discount and override columns — and a side drawer gave it roughly a third of
 * the screen. The product table was already clipping its own "No variants —
 * cannot quote" cell at that width, and the grid below it would have been
 * worse. A grid needs the page.
 *
 * ## The design picker stacks ON TOP
 *
 * `AdminLineDesignsPanel` says which design each line was made to. Inline below
 * the grid (#1501's original home) it competes with the grid for vertical
 * space, and the operator has to scroll past every line to reach it. As a
 * `StackedFocusModal` it opens OVER the grid it annotates, which is what
 * stacking is for — and `RouteFocusModal` already provides the
 * `StackedModalProvider` it needs, so it costs nothing structural.
 *
 * 🔑 It is still not a grid COLUMN, for the reason #1501 gave: a design is
 * picked from hundreds by name, which is a search, and a combobox would fight
 * the grid's arrow-key navigation.
 */
const DraftItemsForm = ({ draftId }: { draftId: string }) => {
  const { handleSuccess } = useRouteModal()
  const { data, isLoading } = useQuoteDraft(draftId)
  const draft = data?.draft

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

  useEffect(() => {
    if (!draft) return
    /**
     * 🔑 The trade price and the typed weight are hydrated too (#1806).
     *
     * They used not to be, and the modal reopened with blank price cells over
     * lines that HAD a negotiated price — so the next Save, built from those
     * blanks, erased it. The mapping is shared with the save that mirrors it;
     * a round trip that loses a field is the same silent discard.
     */
    const {
      quantities,
      discounts,
      overrides,
      weights,
      design_by_variant: designByVariant,
      product_ids: productIds,
    } = basketFromDraftLines(draft.lines as any)
    form.reset({
      ...form.getValues(),
      // 🔴 `?? ""` throughout: a null column handed to a controlled input makes
      // React swap it to an uncontrolled one, and the field stops tracking.
      partner_id: draft.partner_id ?? "",
      region_id: (draft as any).region_id ?? "",
      currency_code: draft.currency_code ?? "",
      destination_country_code: (draft as any).destination_country_code ?? "",
      product_ids: productIds,
      quantities,
      discounts,
      overrides,
      weights,
      design_by_variant: designByVariant,
    } as any)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.id])

  const [tab, setTab] = useState<ItemsTab>(ItemsTab.PRODUCTS)

  const { mutate: save, isPending } = useUpdateQuoteDraft(draftId, {
    onSuccess: () => {
      toast.success("Items saved.")
      handleSuccess(`/quotes/drafts/${draftId}`)
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not save the items."),
  })

  /**
   * The panel wants the selected PRODUCTS, not their ids — it lists a row per
   * variant. Derived exactly as `QuantitiesStep` derives its own `selected`,
   * so the stacked panel and the grid it annotates can never disagree about
   * which lines exist.
   */
  const pickedIds = useWatch({ control: form.control, name: "product_ids" })
  /** What the first step has answered, watched so the second step reacts to it. */
  const picked = (pickedIds ?? []) as any[]
  const { products } = useProducts({ limit: 100 } as any)
  const selectedProducts = useMemo(() => {
    const wanted = new Set(((pickedIds ?? []) as any[]).map((p) => p.id))
    return ((products ?? []) as any[]).filter((p) => wanted.has(p.id))
  }, [products, pickedIds])

  /**
   * 🔴 NOT `form.handleSubmit`.
   *
   * The form is resolved against `AdminQuoteCreateSchema` — the WHOLE quote —
   * because the steps it hosts are written against that shape. This modal
   * hydrates only the partner, the lane and the basket, so `buyer_email`,
   * `region_id` and the rest are absent and the schema fails. `handleSubmit`
   * then never calls its callback: Save did nothing, silently, and the errors
   * attached to fields this modal does not render — an error count with
   * nothing on screen to point at.
   *
   * The basket is saved by reading the values directly, exactly as the draft
   * page's drawers already do. The resolver stays for the DataGrid's own
   * per-cell validation; it simply no longer gates a save it cannot judge.
   */
  const handleSave = () => {
    const values = form.getValues()

    /**
     * 🔴 Refused HERE, with the line in hand.
     *
     * Both rails' schemas refuse a line carrying a discount AND a flat price —
     * "which one wins" is a question that should not have an answer. Forwarding
     * the pair would meet the operator as a 400 naming a zod path instead of a
     * sentence naming the row they need to clear.
     */
    const conflicts = conflictingOverrides(values as any)
    if (conflicts.length) {
      toast.error(
        `Clear either the discount or the unit price on ${conflicts.length} line${
          conflicts.length > 1 ? "s" : ""
        } — a line takes one or the other, never both.`
      )
      return
    }

    /**
     * The negotiated price travels with the line (#1806). Built by the shared
     * mapping rather than inline: the draft page's Mint re-saves this same
     * basket from its own form, and a second copy that forgot a column is how
     * a price saved here was silently dropped on the way to the mint.
     */
    const lines = draftLinesFromForm(values as any)

    /**
     * An empty basket IS savable here — this modal OWNS the basket, so
     * clearing it is a real instruction rather than the silence that must
     * never empty it from another section.
     */
    save({ lines })
  }

  /**
   * A skeleton, not a spinner and not nothing.
   *
   * The draft is fetched before anything can be hydrated, and rendering the
   * grid against empty defaults first makes the modal flash an empty basket at
   * an operator whose draft has items — which reads as data loss.
   */
  if (isLoading || !draft) {
    return (
      <>
        {/*
          🔴 The loading branch needs a `Title` too.
          
          The dialog is already mounted while the draft is being fetched, and a
          branch that returns only a Body leaves Radix with an untitled dialog
          for that whole window — which is exactly what a screen-reader user
          meets first. The warning only appears on this route because only this
          route has a loading branch.
        */}
        <RouteFocusModal.Header>
          <RouteFocusModal.Title asChild>
            <span className="sr-only">Edit items</span>
          </RouteFocusModal.Title>
        </RouteFocusModal.Header>
        <RouteFocusModal.Body className="flex-1 overflow-y-auto p-6">
          <TwoColumnPageSkeleton mainSections={2} sidebarSections={0} />
        </RouteFocusModal.Body>
      </>
    )
  }

  return (
    <RouteFocusModal.Form form={form}>
      <ProgressTabs
        value={tab}
        onValueChange={(v) => setTab(v as ItemsTab)}
        className="flex h-full flex-col overflow-hidden"
      >
        {/* Enter must not submit a schema this modal cannot satisfy. */}
        <KeyboundForm
          onSubmit={(e: any) => e.preventDefault()}
          className="flex h-full flex-col"
        >
        <RouteFocusModal.Header>
          <RouteFocusModal.Title asChild>
            <span className="sr-only">Edit items</span>
          </RouteFocusModal.Title>
          <div className="flex w-full items-center justify-between gap-x-2">
            <div className="-my-2 w-full max-w-[560px] border-l">
              <ProgressTabs.List className="grid w-full grid-cols-3">
                <ProgressTabs.Trigger
                  status={picked.length ? "completed" : "in-progress"}
                  value={ItemsTab.PRODUCTS}
                >
                  Products &amp; designs
                </ProgressTabs.Trigger>
                <ProgressTabs.Trigger
                  status={tab === ItemsTab.QUANTITIES ? "in-progress" : "not-started"}
                  value={ItemsTab.QUANTITIES}
                >
                  Quantities
                </ProgressTabs.Trigger>
                <ProgressTabs.Trigger
                  status={tab === ItemsTab.DISCOUNT ? "in-progress" : "not-started"}
                  value={ItemsTab.DISCOUNT}
                >
                  Discount
                </ProgressTabs.Trigger>
              </ProgressTabs.List>
            </div>
            {/*
              🔴 `Trigger` and `Content` must share ONE `StackedFocusModal`
              root. With the trigger outside it, the click never reached the
              stacked modal's own provider — it bubbled to the focus modal
              underneath and CLOSED it, so pressing "Designs per line"
              dismissed the editor instead of opening the picker over it.
            */}
            <StackedFocusModal id={DESIGNS_MODAL_ID}>
              <StackedFocusModal.Trigger asChild>
                <Button type="button" variant="secondary" size="small">
                  Designs per line
                </Button>
              </StackedFocusModal.Trigger>
              <StackedFocusModal.Content className="flex h-[calc(100vh-3rem)] max-h-[calc(100vh-3rem)] flex-col">
            <StackedFocusModal.Header>
              <StackedFocusModal.Title asChild>
                <Heading level="h2">Designs per line</Heading>
              </StackedFocusModal.Title>
            </StackedFocusModal.Header>
            <StackedFocusModal.Body className="flex-1 overflow-y-auto px-6 py-4">
              <Text size="small" className="text-ui-fg-subtle mb-4">
                Says which design each line was made to. Provenance, not
                pricing — the line is still priced through its variant.
              </Text>
              {selectedProducts.length ? (
                <AdminLineDesignsPanel form={form} products={selectedProducts} />
              ) : (
                /*
                 * The panel lists a row per LINE, so with an empty basket it
                 * renders nothing at all — a blank sheet that looks broken
                 * rather than empty. Say which it is.
                 */
                <Text size="small" className="text-ui-fg-subtle">
                  No items in this basket yet. Pick products behind this modal
                  first — a design is recorded against a line, so there has to
                  be a line to record it against.
                </Text>
              )}
            </StackedFocusModal.Body>
            <StackedFocusModal.Footer>
              <StackedFocusModal.Close asChild>
                <Button variant="secondary" size="small" className="ml-auto">
                  Done
                </Button>
              </StackedFocusModal.Close>
            </StackedFocusModal.Footer>
          </StackedFocusModal.Content>
            </StackedFocusModal>
          </div>
        </RouteFocusModal.Header>

        <RouteFocusModal.Body className="flex-1 overflow-hidden">
          <ProgressTabs.Content
            className="size-full overflow-y-auto"
            value={ItemsTab.PRODUCTS}
          >
            <ProductsStep form={form} />
          </ProgressTabs.Content>

          <ProgressTabs.Content
            className="size-full overflow-y-auto"
            value={ItemsTab.QUANTITIES}
          >
            {picked.length ? (
              /* The design panel is lifted out and stacked — see the header. */
              <QuantitiesStep
                form={form}
                showDesignPanel={false}
                showBulkDiscount={false}
              />
            ) : (
              <div className="px-6 py-8">
                <Text size="small" className="text-ui-fg-subtle">
                  Nothing picked yet. The grid shows a row per variant of the
                  products you choose, so it has nothing to show until the first
                  step has an answer.
                </Text>
              </div>
            )}
          </ProgressTabs.Content>

          <ProgressTabs.Content
            className="size-full overflow-y-auto"
            value={ItemsTab.DISCOUNT}
          >
            <div className="px-6 py-6 md:px-16">
              <Heading level="h2">Discount</Heading>
              <Text size="small" className="text-ui-fg-subtle mb-6">
                One percentage across the basket. A commercial decision, so it
                gets its own step rather than a strip above the grid.
              </Text>
              <BulkDiscountPanel form={form} products={selectedProducts} />
            </div>
          </ProgressTabs.Content>
        </RouteFocusModal.Body>

        <RouteFocusModal.Footer>
          <div className="flex items-center justify-end gap-x-2">
            <RouteFocusModal.Close asChild>
              <Button variant="secondary" size="small" type="button">
                Cancel
              </Button>
            </RouteFocusModal.Close>
            {/*
              🔴 Save is ALWAYS available, Continue is the extra.
              
              Gating Save behind the last step would make an operator who only
              wanted to fix a quantity walk through Discount to persist it —
              and steps exist here to stop two tables fighting for one screen,
              not to impose an order on a basket that is already saved as a
              whole.
            */}
            {tab !== ItemsTab.DISCOUNT && (
              <Button
                key="continue"
                type="button"
                variant="secondary"
                size="small"
                onClick={() =>
                  setTab(
                    tab === ItemsTab.PRODUCTS
                      ? ItemsTab.QUANTITIES
                      : ItemsTab.DISCOUNT
                  )
                }
              >
                Continue
              </Button>
            )}
            <Button
              key="submit"
              type="button"
              variant="primary"
              size="small"
              isLoading={isPending}
              onClick={handleSave}
            >
              Save
            </Button>
          </div>
        </RouteFocusModal.Footer>

        </KeyboundForm>
      </ProgressTabs>
    </RouteFocusModal.Form>
  )
}

const DraftItemsPage = () => {
  const { id } = useParams()
  return (
    <RouteFocusModal prev={`/quotes/drafts/${id}`}>
      <DraftItemsForm draftId={id!} />
    </RouteFocusModal>
  )
}

export const handle = {
  breadcrumb: () => "Items",
}

export default DraftItemsPage
