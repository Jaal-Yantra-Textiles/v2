import { ChevronDownMini, ChevronRightMini } from "@medusajs/icons"
import { Badge, Checkbox, Input, Text, Tooltip } from "@medusajs/ui"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import {
  usePartnerMintDesignVariant,
  usePartnerQuotableDesigns,
  type QuotableDesign,
} from "../../../../../hooks/api/partner-quotes"

type QuoteDesignsPanelProps = {
  /** variant_id → design_id, as the form currently holds it. */
  designByVariant: Record<string, string>
  onToggle: (design: QuotableDesign, selected: boolean) => void
  /**
   * The quote's currency. A made-to-order variant has to be LISTED in it —
   * the estimate behind it is denominated in the design's own cost currency
   * and is converted on the way through.
   */
  currencyCode: string
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
 * find it here, and never learns why.
 *
 * ## Made-to-order rows
 *
 * "No product behind it" used to be the commonest reason a row was greyed, and
 * it was the wrong answer for custom work: a design whose production run is in
 * the FUTURE has no product by definition. Such a row is now pickable — ticking
 * it MINTS the variant it will be quoted through, priced from what comparable
 * work has cost, so the rest of the wizard sees an ordinary variant.
 *
 * ⚠️ The mint can still refuse, when the estimator has nothing at all to go on.
 * That answer arrives as a 422 and is rendered on the row, because it names
 * something the partner can actually fix — add a bill of materials, or price a
 * sample — where "cannot be quoted" named nothing.
 *
 * Collapsed by default: most quotes are product quotes, and a panel that pushes
 * the product table off the screen for everyone would be a poor trade.
 */
export const QuoteDesignsPanel = ({
  designByVariant,
  onToggle,
  currencyCode,
}: QuoteDesignsPanelProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState("")
  /** design_id → why its mint was refused. Cleared when it is retried. */
  const [mintErrors, setMintErrors] = useState<Record<string, string>>({})
  const [minting, setMinting] = useState<string | null>(null)

  const { mutateAsync: mintVariant } = usePartnerMintDesignVariant()

  /**
   * Ticking a made-to-order row has to produce a variant BEFORE the parent can
   * hold it: the form's basket is keyed by variant all the way down.
   *
   * Un-ticking never mints — it passes the row straight through, so a design
   * whose mint failed can be un-ticked without trying again.
   */
  const handleToggle = async (design: QuotableDesign, selected: boolean) => {
    if (!selected || design.variant_id || !design.made_to_order) {
      onToggle(design, selected)
      return
    }

    setMinting(design.id)
    setMintErrors((prev) => {
      const next = { ...prev }
      delete next[design.id]
      return next
    })

    try {
      const { design: minted } = await mintVariant({
        design_id: design.id,
        currency_code: currencyCode,
      })
      // The row the parent gets is the row the server just made real.
      onToggle(
        {
          ...design,
          quotable: true,
          variant_id: minted.variant_id,
          product_id: minted.product_id,
        },
        true
      )
    } catch (e: any) {
      /**
       * 🔴 Rendered, not swallowed. The message is the estimator's own — "no
       * bill of materials, no completed run and no comparable work" — and it
       * is the only thing that tells the partner what to do next.
       */
      setMintErrors((prev) => ({
        ...prev,
        [design.id]:
          e?.message ??
          t(
            "quotes.create.designs.mintFailed",
            "This design could not be priced yet."
          ),
      }))
    } finally {
      setMinting(null)
    }
  }

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
                  onToggle={handleToggle}
                  minting={minting === design.id}
                  mintError={mintErrors[design.id] ?? null}
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
  minting,
  mintError,
}: {
  design: QuotableDesign
  selected: boolean
  onToggle: (design: QuotableDesign, selected: boolean) => void
  minting?: boolean
  mintError?: string | null
}) => {
  // Pickable either because a variant already backs it, or because one will be
  // minted the moment it is ticked.
  const pickable = design.quotable || design.made_to_order

  const row = (
    <li
      className={`flex items-center gap-x-3 rounded-md px-2 py-2 ${
        pickable ? "hover:bg-ui-bg-base" : "opacity-60"
      }`}
    >
      <Checkbox
        checked={selected}
        // 🔴 Disabled rather than hidden. The partner has to be able to SEE the
        // design and read why it cannot be quoted.
        disabled={!pickable || minting}
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
        {/*
          One subtitle, in precedence order: a failed mint is the most recent
          and most actionable thing that happened; a resolver reason is next;
          the made-to-order note is a state, not a problem, and comes last.
        */}
        {mintError ? (
          <Text size="xsmall" className="text-ui-fg-error">
            {mintError}
          </Text>
        ) : design.reason ? (
          <Text size="xsmall" className="text-ui-fg-subtle">
            {design.reason}
          </Text>
        ) : design.made_to_order ? (
          <Text size="xsmall" className="text-ui-fg-subtle">
            {minting
              ? "Pricing from comparable work…"
              : "No product yet — priced from comparable work when you pick it."}
          </Text>
        ) : null}
      </div>
      {design.made_to_order ? (
        <Badge size="2xsmall" color="orange" className="ml-auto shrink-0">
          Made to order
        </Badge>
      ) : null}
      {design.product_type ? (
        <Badge
          size="2xsmall"
          className={design.made_to_order ? "shrink-0" : "ml-auto shrink-0"}
        >
          {design.product_type}
        </Badge>
      ) : null}
    </li>
  )

  // The reason is already on the row; the tooltip is for the truncated case.
  const tip = mintError ?? design.reason
  return tip ? <Tooltip content={tip}>{row}</Tooltip> : row
}
