import { zodResolver } from "@hookform/resolvers/zod"
import { Button, Heading, Text, toast } from "@medusajs/ui"
import { useEffect, useMemo } from "react"
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
import { AdminLineDesignsPanel } from "../../../create/line-designs-panel"
import {
  AdminQuoteCreateSchema,
  AdminQuoteCreateSchemaType,
} from "../../../create/schema"
import { ProductsStep } from "../../../create/steps/products-step"
import { QuantitiesStep } from "../../../create/steps/quantities-step"

const DESIGNS_MODAL_ID = "quote-draft-line-designs"

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
      // 🔴 `?? ""` throughout: a null column handed to a controlled input makes
      // React swap it to an uncontrolled one, and the field stops tracking.
      partner_id: draft.partner_id ?? "",
      region_id: (draft as any).region_id ?? "",
      currency_code: draft.currency_code ?? "",
      destination_country_code: (draft as any).destination_country_code ?? "",
      product_ids: productIds,
      quantities,
      design_by_variant: designByVariant,
    } as any)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.id])

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
  const { products } = useProducts({ limit: 100 } as any)
  const selectedProducts = useMemo(() => {
    const wanted = new Set(((pickedIds ?? []) as any[]).map((p) => p.id))
    return ((products ?? []) as any[]).filter((p) => wanted.has(p.id))
  }, [products, pickedIds])

  const handleSubmit = form.handleSubmit(() => {
    const values = form.getValues()
    const lines = Object.entries(values.quantities ?? {})
      .filter(([, qty]) => typeof qty === "number" && qty > 0)
      .map(([variant_id, quantity], index) => ({
        variant_id,
        quantity: quantity as number,
        position: index,
        ...(values.design_by_variant?.[variant_id]
          ? { design_id: values.design_by_variant[variant_id] }
          : {}),
      }))

    /**
     * An empty basket IS savable here — this modal OWNS the basket, so
     * clearing it is a real instruction rather than the silence that must
     * never empty it from another section.
     */
    save({ lines })
  })

  /**
   * A skeleton, not a spinner and not nothing.
   *
   * The draft is fetched before anything can be hydrated, and rendering the
   * grid against empty defaults first makes the modal flash an empty basket at
   * an operator whose draft has items — which reads as data loss.
   */
  if (isLoading || !draft) {
    return (
      <RouteFocusModal.Body className="flex-1 overflow-y-auto p-6">
        <TwoColumnPageSkeleton mainSections={2} sidebarSections={0} />
      </RouteFocusModal.Body>
    )
  }

  return (
    <RouteFocusModal.Form form={form}>
      <KeyboundForm onSubmit={handleSubmit} className="flex h-full flex-col">
        <RouteFocusModal.Header>
          <RouteFocusModal.Title asChild>
            <span className="sr-only">Edit items</span>
          </RouteFocusModal.Title>
          <div className="flex w-full items-center justify-end gap-x-2">
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

        <RouteFocusModal.Body className="flex-1 overflow-y-auto">
          <div className="flex flex-col gap-y-6">
            <ProductsStep form={form} />
            {/* The panel is lifted out of the step and stacked — see the header. */}
            <QuantitiesStep form={form} showDesignPanel={false} />
          </div>
        </RouteFocusModal.Body>

        <RouteFocusModal.Footer>
          <div className="flex items-center justify-end gap-x-2">
            <RouteFocusModal.Close asChild>
              <Button variant="secondary" size="small" type="button">
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
