"use client"

import { Button, Text, clx } from "@medusajs/ui"
import { HttpTypes } from "@medusajs/types"
import { useParams } from "next/navigation"
import { useState } from "react"

import { addMadeToSpecToCart, type StoreProductSpec } from "@lib/data/product-spec"

/**
 * #1349 — ordering a piece made to the partner's spec, in a colour the customer
 * chooses from the partner's palette.
 *
 * Deliberately SEPARATE from the ordinary add-to-cart control rather than a
 * mode inside it. "Buy this piece" and "have this woven for me in walnut, in
 * about six weeks" are different purchases with different lead times, and
 * folding them into one button hides the wait until checkout.
 *
 * The palette rendered here is only what the storefront was told is available;
 * the backend re-checks the choice on submit, so a stale page cannot place an
 * order for a colour the partner has since withdrawn.
 */

type Props = {
  spec: StoreProductSpec
  variants: HttpTypes.StoreProductVariant[]
}

const MadeToOrderForm = ({ spec, variants }: Props) => {
  const countryCode = useParams().countryCode as string

  const [variantId, setVariantId] = useState(variants[0]?.id ?? "")
  const [color, setColor] = useState<string | null>(
    spec.colors[0]?.name ?? null
  )
  const [note, setNote] = useState("")
  const [isAdding, setIsAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState(false)

  const handleSubmit = async () => {
    setIsAdding(true)
    setError(null)
    try {
      await addMadeToSpecToCart({
        variantId,
        quantity: 1,
        color,
        note,
        countryCode,
      })
      setAdded(true)
    } catch (e: any) {
      // The backend's rejection names the colours that ARE available. Showing
      // our own generic message instead would throw that away.
      setError(e?.message || "We couldn't add this made-to-order piece.")
    } finally {
      setIsAdding(false)
    }
  }

  return (
    <div className="flex flex-col gap-y-4 border-t border-ui-border-base pt-6">
      <div className="flex flex-col gap-y-1">
        <Text className="text-ui-fg-base font-medium">Have it made for you</Text>
        <Text size="small" className="text-ui-fg-subtle">
          {spec.custom_order_lead_time_days
            ? `Woven to order in your colour — about ${spec.custom_order_lead_time_days} days.`
            : "Woven to order in the colour you choose."}
        </Text>
      </div>

      {variants.length > 1 && (
        <div className="flex flex-col gap-y-2">
          <Text size="small" className="text-ui-fg-subtle">
            Size
          </Text>
          <select
            className="border-ui-border-base bg-ui-bg-field h-10 rounded-md border px-3 text-sm"
            value={variantId}
            onChange={(e) => setVariantId(e.target.value)}
          >
            {variants.map((variant) => (
              <option key={variant.id} value={variant.id}>
                {variant.title}
              </option>
            ))}
          </select>
        </div>
      )}

      {!!spec.colors.length && (
        <div className="flex flex-col gap-y-2">
          <Text size="small" className="text-ui-fg-subtle">
            Colour{color ? ` — ${color}` : ""}
          </Text>
          <div className="flex flex-wrap gap-2">
            {spec.colors.map((option) => {
              const selected = option.name === color
              return (
                <button
                  key={option.id ?? option.name}
                  type="button"
                  onClick={() => setColor(option.name)}
                  aria-pressed={selected}
                  // The name is in the label, not only the swatch — a palette
                  // told apart by colour alone is unusable to anyone who
                  // cannot distinguish the swatches.
                  aria-label={
                    option.usage_notes
                      ? `${option.name} — ${option.usage_notes}`
                      : option.name
                  }
                  title={option.usage_notes ?? option.name}
                  className={clx(
                    "flex items-center gap-x-2 rounded-full border py-1 pl-1 pr-3 transition-colors",
                    selected
                      ? "border-ui-fg-base bg-ui-bg-base"
                      : "border-ui-border-base bg-ui-bg-subtle hover:border-ui-fg-muted"
                  )}
                >
                  <span
                    className="border-ui-border-base size-6 rounded-full border"
                    style={{ backgroundColor: option.hex_code ?? "transparent" }}
                    aria-hidden
                  />
                  <Text size="small">{option.name}</Text>
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-y-2">
        <Text size="small" className="text-ui-fg-subtle">
          Anything we should know? (optional)
        </Text>
        <textarea
          rows={2}
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="For a September wedding — a wider border if possible."
          className="border-ui-border-base bg-ui-bg-field rounded-md border px-3 py-2 text-sm"
        />
      </div>

      {error && (
        <Text size="small" className="text-ui-fg-error">
          {error}
        </Text>
      )}

      <Button
        onClick={handleSubmit}
        isLoading={isAdding}
        disabled={isAdding || !variantId}
        variant="secondary"
        className="w-full"
      >
        {added ? "Added — add another" : "Add made-to-order piece"}
      </Button>

      <Text size="xsmall" className="text-ui-fg-muted">
        Made-to-order pieces are woven for you after the order is placed.
      </Text>
    </div>
  )
}

export default MadeToOrderForm
