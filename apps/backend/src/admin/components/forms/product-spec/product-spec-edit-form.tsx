import { Button, Heading, Text, toast } from "@medusajs/ui"
import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"

import { ProductSpecForm } from "../../product-spec-form"
import { RouteFocusModal } from "../../modal/route-focus-modal"
import { useRouteModal } from "../../modal/use-route-modal"
import {
  useProductSpec,
  useUpsertProductSpec,
  useWeaveCatalog,
  type ProductSpecPayload,
} from "../../../hooks/api/product-spec"

/**
 * #1349 — the ADMIN production spec editor.
 *
 * Lives on its own route (`/products/:id/spec`) rather than inside the widget,
 * so the edit is a `RouteFocusModal` like every other admin edit of this size —
 * closing returns to the product page, the URL is shareable, and back works.
 *
 * The widget it replaced held the modal itself with local `open` state. A
 * routed modal cannot be driven that way: `RouteFocusModal` opens on mount and
 * navigates to `prev` on close, so hosting one inside an always-mounted widget
 * would pop the editor open on every product page load and, on close, navigate
 * off the product entirely.
 *
 * NOTE the host/child split below. `RouteFocusModal` creates the
 * `RouteModalProvider` around its OWN children, so the component that renders
 * the modal must not call `useRouteModal()` — that is what threw
 * "useRouteModal must be used within a RouteModalProvider" on the partner side
 * of this same feature.
 */

const EMPTY: ProductSpecPayload = {
  weave_technique: null,
  weave_label: null,
  params: null,
  finishes: [],
  notes: null,
  accepting_custom_orders: false,
  custom_order_lead_time_days: null,
  colors: [],
  fields: [],
}

export const ProductSpecEditForm = () => {
  const { id } = useParams()
  const productId = id!

  const { handleSuccess } = useRouteModal()

  const { spec, isLoading } = useProductSpec(productId)
  const { techniques, families, isLoading: catalogLoading } = useWeaveCatalog()
  const { mutateAsync, isPending } = useUpsertProductSpec(productId)

  const [value, setValue] = useState<ProductSpecPayload>(EMPTY)
  const [dirty, setDirty] = useState(false)

  // Hydrate once the saved spec loads. Guarded on `dirty` so a slow refetch
  // cannot overwrite edits the admin has already started making.
  useEffect(() => {
    if (!spec || dirty) {
      return
    }
    setValue({
      weave_technique: spec.weave_technique ?? null,
      weave_label: spec.weave_label ?? null,
      params: spec.params ?? null,
      finishes: spec.finishes ?? [],
      notes: spec.notes ?? null,
      accepting_custom_orders: !!spec.accepting_custom_orders,
      custom_order_lead_time_days: spec.custom_order_lead_time_days ?? null,
      colors: (spec.colors ?? [])
        .slice()
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
      fields: (spec.fields ?? [])
        .slice()
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    })
  }, [spec, dirty])

  const handleSave = async () => {
    // Drop half-written rows rather than sending them: the route rejects a
    // colour with no name, and losing the whole save over a row the admin
    // forgot about is worse than silently ignoring it.
    const payload: ProductSpecPayload = {
      ...value,
      weave_label: value.weave_label?.trim() ? value.weave_label.trim() : null,
      notes: value.notes?.trim() ? value.notes.trim() : null,
      colors: (value.colors ?? []).filter((c) => c.name.trim()),
      fields: (value.fields ?? []).filter((f) => (f.label ?? f.key).trim()),
    }

    try {
      await mutateAsync(payload)
      setDirty(false)
      toast.success("Production spec saved")
      handleSuccess()
    } catch (e: any) {
      toast.error(e?.message || "Could not save the production spec")
    }
  }

  return (
    <>
      <RouteFocusModal.Header>
        <div className="flex items-center justify-end gap-x-2">
          <RouteFocusModal.Close asChild>
            <Button size="small" variant="secondary">
              Cancel
            </Button>
          </RouteFocusModal.Close>
          <Button
            size="small"
            onClick={handleSave}
            isLoading={isPending}
            disabled={isLoading || catalogLoading}
          >
            Save
          </Button>
        </div>
      </RouteFocusModal.Header>

      <RouteFocusModal.Title asChild>
        <span className="sr-only">Edit production spec</span>
      </RouteFocusModal.Title>
      <RouteFocusModal.Description asChild>
        <span className="sr-only">
          The weave, colours and specs this product is made to.
        </span>
      </RouteFocusModal.Description>

      {/* FocusModal.Body does not scroll on its own — without overflow-y-auto a
       *  spec with a long palette is unreachable below the fold. */}
      <RouteFocusModal.Body className="flex flex-1 flex-col overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[720px] flex-col gap-y-6 px-6 py-16">
          <div className="flex flex-col gap-y-1">
            <Heading level="h2">Production spec</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              What this product is made to.
            </Text>
          </div>

          <ProductSpecForm
            value={value}
            onChange={(next) => {
              setDirty(true)
              setValue(next)
            }}
            techniques={techniques}
            families={families}
            isLoading={isLoading || catalogLoading}
          />
        </div>
      </RouteFocusModal.Body>
    </>
  )
}
