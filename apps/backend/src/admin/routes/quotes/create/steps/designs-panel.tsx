import { Badge, Checkbox, Input, Text } from "@medusajs/ui"
import { useState } from "react"

import {
  useQuotableDesigns,
  type QuotableDesign,
} from "../../../../hooks/api/quotes"

type Props = {
  /** The partner already chosen in step 1. Narrows the list; not a permission. */
  partnerId?: string | null
  /** variant_id → design_id, as the form currently holds it. */
  designByVariant: Record<string, string>
  onToggle: (design: QuotableDesign, selected: boolean) => void
}

/**
 * Pick a design instead of a product (#1486) — the admin twin of the partner
 * wizard's panel.
 *
 * A design is not a third kind of thing to quote; it is a different way of
 * finding the same variant. Selecting one selects the product behind it, so the
 * quantities step, the readiness preflight and the price list stay the single
 * tested path.
 *
 * 🔑 Unquotable designs are shown, greyed, with their reason. An admin who can
 * see a design in the designs app and cannot find it here has no way to learn
 * that the fix is "create a product from it first".
 */
export const DesignsPanel = ({
  partnerId,
  designByVariant,
  onToggle,
}: Props) => {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState("")

  const { designs, isLoading } = useQuotableDesigns(
    { partner_id: partnerId ?? undefined, q: q.trim() || undefined, limit: 50 },
    { enabled: open }
  )

  const picked = new Set(Object.values(designByVariant ?? {}))

  return (
    <div className="mx-6 mt-4 rounded-lg border border-ui-border-base bg-ui-bg-subtle">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-x-2 px-4 py-3 text-left"
      >
        <Text size="small" weight="plus">
          Quote a design
        </Text>
        <Text size="small" className="text-ui-fg-subtle">
          Pick by design instead of by product.
        </Text>
        {picked.size > 0 && (
          <Badge size="2xsmall" className="ml-auto">
            {picked.size}
          </Badge>
        )}
      </button>

      {open && (
        <div className="flex flex-col gap-y-2 border-t border-ui-border-base px-4 py-3">
          <Input
            size="small"
            placeholder="Search designs"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />

          {isLoading ? (
            <Text size="small" className="text-ui-fg-subtle">
              Loading designs…
            </Text>
          ) : !designs.length ? (
            <Text size="small" className="text-ui-fg-subtle">
              No designs found for this partner.
            </Text>
          ) : (
            <ul className="flex max-h-64 flex-col gap-y-1 overflow-y-auto">
              {designs.map((design) => (
                <li
                  key={design.id}
                  className={`flex items-center gap-x-3 rounded-md px-2 py-2 ${
                    design.quotable ? "hover:bg-ui-bg-base" : "opacity-60"
                  }`}
                >
                  <Checkbox
                    checked={picked.has(design.id)}
                    // Disabled, not hidden — the reason has to be readable.
                    disabled={!design.quotable}
                    onCheckedChange={(value) => onToggle(design, !!value)}
                  />
                  <div className="flex min-w-0 flex-col">
                    <Text size="small" weight="plus" className="truncate">
                      {design.name ?? design.id}
                    </Text>
                    {design.reason ? (
                      <Text size="xsmall" className="text-ui-fg-subtle">
                        {design.reason}
                      </Text>
                    ) : null}
                  </div>
                  {design.product_type ? (
                    <Badge size="2xsmall" className="ml-auto shrink-0">
                      {design.product_type}
                    </Badge>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
