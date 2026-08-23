import { ChevronDownMini, ChevronRightMini } from "@medusajs/icons"
import { Badge, Checkbox, Input, Text, Tooltip } from "@medusajs/ui"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import {
  usePartnerQuotableDesigns,
  type QuotableDesign,
} from "../../../../../hooks/api/partner-quotes"

type QuoteDesignsPanelProps = {
  /** variant_id → design_id, as the form currently holds it. */
  designByVariant: Record<string, string>
  onToggle: (design: QuotableDesign, selected: boolean) => void
}

/**
 * Pick a design instead of a product (#1486).
 *
 * ## Why this sits above the product table rather than replacing it
 *
 * A design is not a third kind of thing to quote — it is a different way of
 * FINDING the same variant. A partner thinks "the Kashida shawl", not
 * "KAS-1 under Shawls". Selecting one here selects the product behind it, so
 * the quantities step, the readiness preflight and the price list are all the
 * paths that already exist and are already tested.
 *
 * 🔑 Unquotable designs are shown, greyed, with the reason on them. Filtering
 * them out makes the picker lie: the partner knows the design exists, cannot
 * find it here, and never learns that the fix is "create a product from it
 * first". The two reasons are genuinely different — no product behind it at
 * all, versus sold as several variants — and each says which it is.
 *
 * Collapsed by default: most quotes are product quotes, and a panel that pushes
 * the product table off the screen for everyone would be a poor trade.
 */
export const QuoteDesignsPanel = ({
  designByVariant,
  onToggle,
}: QuoteDesignsPanelProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState("")

  const { designs, isLoading } = usePartnerQuotableDesigns(
    { q: q.trim() || undefined, limit: 50 },
    { enabled: open }
  )

  const pickedDesignIds = new Set(Object.values(designByVariant ?? {}))

  return (
    <div className="shrink-0 rounded-lg border border-ui-border-base bg-ui-bg-subtle">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-x-2 px-4 py-3 text-left"
      >
        {open ? <ChevronDownMini /> : <ChevronRightMini />}
        <Text size="small" weight="plus">
          {t("quotes.create.designs.heading", "Quote a design")}
        </Text>
        <Text size="small" className="text-ui-fg-subtle">
          {t(
            "quotes.create.designs.hint",
            "Pick by design instead of by product."
          )}
        </Text>
        {pickedDesignIds.size > 0 && (
          <Badge size="2xsmall" className="ml-auto">
            {pickedDesignIds.size}
          </Badge>
        )}
      </button>

      {open && (
        <div className="flex flex-col gap-y-2 border-t border-ui-border-base px-4 py-3">
          <Input
            size="small"
            placeholder={t("quotes.create.designs.search", "Search designs")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />

          {isLoading ? (
            <Text size="small" className="text-ui-fg-subtle">
              {t("quotes.create.designs.loading", "Loading designs…")}
            </Text>
          ) : !designs.length ? (
            <Text size="small" className="text-ui-fg-subtle">
              {t(
                "quotes.create.designs.empty",
                "No designs found. Designs appear here once you own or are assigned to them."
              )}
            </Text>
          ) : (
            <ul className="flex max-h-64 flex-col gap-y-1 overflow-y-auto">
              {designs.map((design) => (
                <DesignRow
                  key={design.id}
                  design={design}
                  selected={pickedDesignIds.has(design.id)}
                  onToggle={onToggle}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

const DesignRow = ({
  design,
  selected,
  onToggle,
}: {
  design: QuotableDesign
  selected: boolean
  onToggle: (design: QuotableDesign, selected: boolean) => void
}) => {
  const row = (
    <li
      className={`flex items-center gap-x-3 rounded-md px-2 py-2 ${
        design.quotable ? "hover:bg-ui-bg-base" : "opacity-60"
      }`}
    >
      <Checkbox
        checked={selected}
        // 🔴 Disabled rather than hidden. The partner has to be able to SEE the
        // design and read why it cannot be quoted.
        disabled={!design.quotable}
        onCheckedChange={(value) => onToggle(design, !!value)}
      />
      {design.thumbnail_url ? (
        <img
          src={design.thumbnail_url}
          alt=""
          className="size-8 shrink-0 rounded object-cover"
        />
      ) : (
        <div className="size-8 shrink-0 rounded bg-ui-bg-component" />
      )}
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
  )

  // The reason is already on the row; the tooltip is for the truncated case.
  return design.reason ? <Tooltip content={design.reason}>{row}</Tooltip> : row
}
