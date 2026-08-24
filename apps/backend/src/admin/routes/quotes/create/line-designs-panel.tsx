import { Badge, Text } from "@medusajs/ui"
import { useMemo, useState } from "react"
import { UseFormReturn, useWatch } from "react-hook-form"

import { Combobox } from "../../../components/inputs/combobox/combobox"
import { useQuotableDesigns } from "../../../hooks/api/quotes"
import { assignDesign, designLineRows } from "./line-designs"
import { AdminQuoteCreateSchemaType } from "./schema"

type Props = {
  form: UseFormReturn<AdminQuoteCreateSchemaType>
  products: any[]
}

/**
 * Say which design each line was made to — the admin twin (#1501).
 *
 * ## The gap
 *
 * `design_by_variant` has existed since #1486 and the mint has always frozen it
 * onto the line, but it could only be WRITTEN by the design picker in the
 * previous step. A line found the ordinary way, in the product table, could
 * never be told what it was made to, and a line that arrived through a design
 * could never be corrected. The field was half-writable: one entry point, no
 * edit, no clear.
 *
 * ## Why here and not as a grid column
 *
 * A design is chosen from hundreds by name, which is a search. The quantities
 * grid is a numeric keyboard surface whose arrow-key navigation a combobox
 * would fight.
 *
 * ## 🔑 Designs are listed UNSCOPED
 *
 * Same rule the design picker already follows: an admin legitimately quotes a
 * design the producing partner does not own, and narrowing by partner hid
 * exactly those designs behind what looked like an empty catalogue. The mint
 * still asserts the resolved variant is in the chosen partner's sales channel.
 */
export const AdminLineDesignsPanel = ({ form, products }: Props) => {
  const [search, setSearch] = useState("")

  const quantities = useWatch({ control: form.control, name: "quantities" })
  const designByVariant = useWatch({
    control: form.control,
    name: "design_by_variant",
  })

  const { designs, isLoading } = useQuotableDesigns({
    q: search.trim() || undefined,
    limit: 50,
  })

  const lines = useMemo(
    () => designLineRows(products as any[], quantities as any),
    [products, quantities]
  )

  /**
   * 🔴 Every design, not only the quotable ones.
   *
   * The picker in the previous step greys out a design with no product behind
   * it, because there it has to RESOLVE to a variant. Here the variant is
   * already chosen and the design only says what the line was made to — a
   * sketch with no product of its own is the ordinary answer to that, and the
   * backend accepts it on a line that names its variant.
   */
  const options = useMemo(
    () => (designs ?? []).map((d: any) => ({ label: d.name ?? d.id, value: d.id })),
    [designs]
  )

  const assignedCount = lines.filter(
    (l) => (designByVariant as any)?.[l.id]
  ).length

  if (!lines.length) return null

  return (
    <div className="mx-6 mb-4 flex flex-col gap-y-3 rounded-lg border border-ui-border-base bg-ui-bg-subtle px-4 py-3 md:mx-16">
      <div className="flex items-center gap-x-2">
        <Text size="small" weight="plus">
          Design for each line
        </Text>
        <Text size="small" className="text-ui-fg-subtle">
          Optional. Records what the line was made to; it does not change the
          price.
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
                onChange={(v) =>
                  form.setValue(
                    "design_by_variant",
                    assignDesign(
                      designByVariant as any,
                      line.id,
                      v as string | undefined
                    ),
                    { shouldDirty: true }
                  )
                }
                searchValue={search}
                onSearchValueChange={setSearch}
                allowClear
                isFetchingNextPage={isLoading}
                placeholder="No design"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
