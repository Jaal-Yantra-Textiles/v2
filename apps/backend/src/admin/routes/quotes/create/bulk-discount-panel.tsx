import { Button, Input, Label, Text } from "@medusajs/ui"
import { useState } from "react"
import { UseFormReturn } from "react-hook-form"

import { AdminQuoteCreateSchemaType } from "./schema"

type Props = {
  form: UseFormReturn<AdminQuoteCreateSchemaType>
  /** The selected products, whose variants are the lines to fill. */
  products: any[]
}

/**
 * One percentage across the whole basket (#1446).
 *
 * ## Why it is not a quote-level discount
 *
 * 🔑 It writes into the PER-LINE fields rather than becoming a discount of its
 * own. The backend stores the override per line with the rate and input it was
 * reached by, because that is what makes a quoted number reproducible later — a
 * basket-level percentage would have to be re-derived against catalogue prices
 * that have since moved. So this is a typing shortcut with no server-side
 * counterpart, which is exactly what it should be.
 *
 * ## Why it has its own step now
 *
 * It used to sit in a strip above the quantities DataGrid, competing with it
 * for the same width and reading as a filter over the table rather than an
 * action on it. A discount is a commercial decision, not a grid control: it
 * deserves the room to say what it does to every line and what it clears.
 *
 * The per-line `Discount %` COLUMN stays in the grid. That is per-line data and
 * belongs beside the line it prices; this is only the shortcut that fills it.
 */
export const BulkDiscountPanel = ({ form, products }: Props) => {
  const [bulkDiscount, setBulkDiscount] = useState<string>("")

  /**
   * Fills every variant of every selected product, INCLUDING ones with no
   * quantity yet: a line added afterwards would otherwise silently miss the
   * discount the operator believes they applied to "everything".
   */
  const applyToAll = () => {
    const percent = Number(bulkDiscount)
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) return

    const next: Record<string, number> = {}
    for (const product of products) {
      for (const variant of (product?.variants ?? []) as any[]) {
        next[variant.id] = percent
      }
    }

    form.setValue("discounts", next, { shouldDirty: true })
    /**
     * A flat unit price and a percentage are mutually exclusive per line, and
     * the backend refuses both together. Applying a blanket percentage clears
     * the prices it would otherwise collide with, rather than minting a basket
     * that 400s on submit.
     */
    form.setValue("overrides", {}, { shouldDirty: true })
  }

  return (
    <div className="flex flex-col gap-y-4">
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
        <div className="flex flex-col gap-y-1">
          <Label size="small">Discount % on every line</Label>
          <Input
            type="number"
            min={0}
            max={100}
            className="w-32"
            placeholder="e.g. 15"
            value={bulkDiscount}
            onChange={(e) => setBulkDiscount(e.target.value)}
          />
        </div>
        <Button
          type="button"
          variant="secondary"
          size="small"
          onClick={applyToAll}
          disabled={!bulkDiscount}
        >
          Apply to all
        </Button>
      </div>

      <Text size="small" className="text-ui-fg-subtle">
        A shortcut for the column — every line is still quoted, stored and
        audited individually, and any line can be overridden afterwards on the
        Quantities step.
      </Text>
      <Text size="small" className="text-ui-fg-subtle">
        It fills every variant of every product you picked, including ones with
        no quantity yet, so a line added later does not silently miss the
        discount. Applying it also <strong>clears any flat unit prices</strong>:
        a percentage and a fixed price are mutually exclusive on a line, and the
        backend refuses both together.
      </Text>
      {!products.length && (
        <Text size="small" className="text-ui-fg-muted">
          Nothing picked yet — there are no lines to discount.
        </Text>
      )}
    </div>
  )
}
