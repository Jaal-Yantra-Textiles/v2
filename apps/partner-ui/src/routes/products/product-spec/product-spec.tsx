import { Button, Heading, Text, toast } from "@medusajs/ui"
import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"

import { ProductSpecForm } from "../../../components/forms/product-spec-form"
import { RouteFocusModal, useRouteModal } from "../../../components/modals"
import {
  useProductSpec,
  useUpsertProductSpec,
  useWeaveCatalog,
  type ProductSpecPayload,
} from "../../../hooks/api/products"
import { extractErrorMessage } from "../../../lib/extract-error-message"

/**
 * #1349 — the production spec editor, lifted out of the detail page.
 *
 * The section on product detail now READS; writing happens here, in a focus
 * modal at `products/:id/spec/edit`. The editor is a five-part form (weave,
 * parameters, finishes, palette, custom fields) and inlining it made the
 * detail page's main column mostly spec — while the sections above it, which a
 * partner edits far more often, were pushed off screen.
 *
 * Same `ProductSpecForm` the create wizard hosts. There is still exactly one
 * editor; only its host changed.
 *
 * Split into a host and an inner component on purpose: `RouteFocusModal`
 * creates the `RouteModalProvider` around its OWN children, so a
 * `useRouteModal()` call in the component that renders the modal sits outside
 * the context and throws "useRouteModal must be used within a
 * RouteModalProvider" the moment the route is opened. Every other route modal
 * in this app is shaped the same way — host renders the shell, a child holds
 * the hook.
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

/** Everything that needs the modal context. Only ever rendered as a child of
 *  `RouteFocusModal`, which is what makes `useRouteModal` legal here. */
const ProductSpecEditor = ({ id }: { id: string }) => {
  const { handleSuccess } = useRouteModal()

  const { spec, isLoading, isError, error } = useProductSpec(id)
  const { families, techniques, isLoading: catalogLoading } = useWeaveCatalog()
  const { mutateAsync, isPending } = useUpsertProductSpec(id)

  const [value, setValue] = useState<ProductSpecPayload>(EMPTY)
  const [dirty, setDirty] = useState(false)

  // Hydrate once the saved spec loads. Guarded on `dirty` so a slow refetch
  // cannot overwrite edits the partner has already started making.
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

  if (isError) {
    throw error
  }

  const handleChange = (next: ProductSpecPayload) => {
    setDirty(true)
    setValue(next)
  }

  const handleSave = async () => {
    // Drop half-written rows rather than sending them: the route rejects a
    // colour with no name, and losing the whole save over an empty row the
    // partner forgot about is a worse outcome than silently ignoring it.
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
      toast.success("Spec saved")
      handleSuccess()
    } catch (e) {
      toast.error(extractErrorMessage(e, "Could not save the spec"))
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

      {/* FocusModal.Body does not scroll on its own in this app — without
       *  overflow-y-auto a spec with a long palette is unreachable below the
       *  fold. Same trap the partner-ui modal audit records. */}
      <RouteFocusModal.Body className="flex flex-1 flex-col overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[720px] flex-col gap-y-6 px-6 py-16">
          <div className="flex flex-col gap-y-1">
            <Heading level="h2">Production spec</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              The weave, colours and specs you&apos;ll make this to — agreed
              before you take a custom order.
            </Text>
          </div>

          <ProductSpecForm
            value={value}
            onChange={handleChange}
            techniques={techniques}
            families={families}
            isLoading={isLoading || catalogLoading}
          />
        </div>
      </RouteFocusModal.Body>
    </>
  )
}

export const ProductSpec = () => {
  const { id } = useParams()

  return (
    <RouteFocusModal>
      <ProductSpecEditor id={id!} />
    </RouteFocusModal>
  )
}
