import { Badge, Text } from "@medusajs/ui"
import { HttpTypes } from "@medusajs/types"
import { useMemo, useState } from "react"
import { UseFormReturn, useWatch } from "react-hook-form"
import { useTranslation } from "react-i18next"

import { Combobox } from "../../../../../components/inputs/combobox"
import { usePartnerQuotableDesigns } from "../../../../../hooks/api/partner-quotes"
import { assignDesign, designLineRows } from "./quote-line-designs"
import { QuoteCreateSchemaType } from "./schema"

type QuoteLineDesignsPanelProps = {
  form: UseFormReturn<QuoteCreateSchemaType>
  products: HttpTypes.AdminProduct[]
}

/**
 * Say which design each line was made to (#1501).
 *
 * ## The gap this closes
 *
 * `design_by_variant` has existed since #1486, and the mint has always frozen
 * it onto the line. But it could only ever be WRITTEN by the design picker in
 * the previous step — tick a design there and the product behind it joins the
 * basket, carrying the design. A line the partner found the ordinary way, in
 * the product table, could never be told what it was made to, and a line that
 * arrived through a design could never be corrected.
 *
 * So the field was half-writable: one entry point, no edit, no clear. This is
 * the other half, and it is the one that matches how partners actually work —
 * they know the product, and the design is the thing they add afterwards.
 *
 * ## Why here rather than as a grid column
 *
 * A design is chosen from hundreds by name, which is a search, not a dropdown.
 * The quantities grid is a numeric keyboard surface — every other cell in it
 * takes a number and the arrow keys move between them — and dropping a
 * searchable combobox into that would fight the navigation it depends on.
 *
 * ## 🔑 Only lines that are actually in the basket
 *
 * A variant with no quantity is not a line, so it is not listed. Otherwise a
 * partner who selected a ten-variant product to quote one of them would be
 * asked to attribute nine lines that will never be minted, and the panel would
 * be longer than the quote.
 */
export const QuoteLineDesignsPanel = ({
  form,
  products,
}: QuoteLineDesignsPanelProps) => {
  const { t } = useTranslation()
  const [search, setSearch] = useState("")

  const quantities = useWatch({ control: form.control, name: "quantities" })
  const designByVariant = useWatch({
    control: form.control,
    name: "design_by_variant",
  })

  const { designs, isLoading } = usePartnerQuotableDesigns({
    q: search.trim() || undefined,
    limit: 50,
  })

  /** Every variant carrying a quantity, with the words a partner recognises. */
  const lines = useMemo(
    () => designLineRows(products as any[], quantities as any),
    [products, quantities]
  )

  /**
   * 🔴 Every design, not only the quotable ones.
   *
   * The picker in the previous step greys out a design with no product behind
   * it, because there it has to RESOLVE to a variant. Here the variant is
   * already chosen and the design is only saying what the line was made to —
   * a sketch with no product of its own is the ordinary answer to that, and
   * the backend accepts it on a line that names its variant.
   */
  const options = useMemo(
    () =>
      (designs ?? []).map((d) => ({
        label: d.name ?? d.id,
        value: d.id,
      })),
    [designs]
  )

  const assign = (variantId: string, designId?: string) => {
    form.setValue(
      "design_by_variant",
      assignDesign(designByVariant as any, variantId, designId),
      { shouldDirty: true }
    )
  }

  const assignedCount = lines.filter(
    (l) => (designByVariant as any)?.[l.id]
  ).length

  if (!lines.length) return null

  return (
    <div className="flex flex-col gap-y-3 rounded-lg border border-ui-border-base bg-ui-bg-subtle px-4 py-3">
      <div className="flex items-center gap-x-2">
        <Text size="small" weight="plus">
          {t("quotes.create.lineDesigns.heading", "Design for each line")}
        </Text>
        <Text size="small" className="text-ui-fg-subtle">
          {t(
            "quotes.create.lineDesigns.hint",
            "Optional. Records what the line was made to; it does not change the price."
          )}
        </Text>
        {assignedCount > 0 && (
          <Badge size="2xsmall" className="ml-auto">
            {assignedCount}/{lines.length}
          </Badge>
        )}
      </div>

      <div className="flex flex-col gap-y-2">
        {lines.map((line) => (
          <div
            key={line.id}
            className="flex flex-col gap-y-1 md:flex-row md:items-center md:gap-x-3"
          >
            <Text size="small" className="truncate md:w-1/2">
              {line.label}
            </Text>
            <div className="md:w-1/2">
              <Combobox
                options={options}
                value={((designByVariant as any)?.[line.id] as string) ?? ""}
                onChange={(v) => assign(line.id, v as string | undefined)}
                searchValue={search}
                onSearchValueChange={setSearch}
                allowClear
                isFetchingNextPage={isLoading}
                placeholder={t(
                  "quotes.create.lineDesigns.placeholder",
                  "No design"
                )}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
