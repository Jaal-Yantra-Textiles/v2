import { HttpTypes } from "@medusajs/types"
import { Button, Container, Heading, Text, toast } from "@medusajs/ui"
import { useEffect, useState } from "react"

import { ProductSpecForm } from "../../../../../components/forms/product-spec-form"
import {
  useProductSpec,
  useUpsertProductSpec,
  useWeaveCatalog,
  type ProductSpecPayload,
} from "../../../../../hooks/api/products"
import { extractErrorMessage } from "../../../../../lib/extract-error-message"

type Props = {
  product: HttpTypes.AdminProduct
}

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

/**
 * #1342 — the partner-authored production spec panel on product detail.
 *
 * The same editor the create wizard uses, loaded from and saved to the linked
 * `product_spec` module. Colours and fields are sent every save (they replace
 * what is stored), which is why an empty palette here means "no palette" rather
 * than "leave it alone".
 */
export const ProductSpecSection = ({ product }: Props) => {
  const { spec, isLoading } = useProductSpec(product.id)
  const { families, techniques, isLoading: catalogLoading } = useWeaveCatalog()
  const { mutateAsync, isPending } = useUpsertProductSpec(product.id)

  const [value, setValue] = useState<ProductSpecPayload>(EMPTY)
  const [dirty, setDirty] = useState(false)

  // Hydrate once the saved spec loads. Guarded on `dirty` so a slow refetch
  // cannot overwrite edits the partner has already started making.
  useEffect(() => {
    if (!spec || dirty) return
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
    } catch (e) {
      toast.error(extractErrorMessage(e, "Could not save the spec"))
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Production spec</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            The weave, colours and specs you'll make this to — agreed before you
            take a custom order.
          </Text>
        </div>
        <Button
          size="small"
          onClick={handleSave}
          isLoading={isPending}
          disabled={isLoading || !dirty}
        >
          Save
        </Button>
      </div>

      <div className="px-6 py-6">
        <ProductSpecForm
          value={value}
          onChange={handleChange}
          techniques={techniques}
          families={families}
          isLoading={isLoading || catalogLoading}
        />
      </div>
    </Container>
  )
}
