import { HttpTypes } from "@medusajs/types"
import { Text } from "@medusajs/ui"

/**
 * #1349 — the made-to-order snapshot written onto the line item by
 * `/store/carts/:id/made-to-spec`. Read defensively: it is metadata, so an
 * older line item, or one added by any other path, simply has none.
 */
type MadeToSpec = {
  weave?: string | null
  color_name?: string
  color_hex?: string | null
  lead_time_days?: number | null
  note?: string | null
  options?: { key: string; label: string; value: string; note?: string | null }[]
}

const readMadeToSpec = (
  metadata: Record<string, unknown> | null | undefined
): MadeToSpec | null => {
  const value = metadata?.made_to_spec
  if (!value || typeof value !== "object") {
    return null
  }
  return value as MadeToSpec
}

type LineItemOptionsProps = {
  variant: HttpTypes.StoreProductVariant | undefined
  /** Line-item metadata, when the caller has it. */
  metadata?: Record<string, unknown> | null
  "data-testid"?: string
  "data-value"?: HttpTypes.StoreProductVariant
}

const LineItemOptions = ({
  variant,
  metadata,
  "data-testid": dataTestid,
  "data-value": dataValue,
}: LineItemOptionsProps) => {
  const madeToSpec = readMadeToSpec(metadata)

  return (
    <div className="flex flex-col gap-y-1">
      <Text
        data-testid={dataTestid}
        data-value={dataValue}
        className="inline-block txt-medium text-ui-fg-subtle w-full overflow-hidden text-ellipsis"
      >
        Variant: {variant?.title}
      </Text>

      {/* Shown wherever a line item is shown — cart, cart dropdown and the
       *  order confirmation all render through this component. A customer who
       *  chose a colourway needs to see it on the order, not only at the
       *  moment they picked it. */}
      {madeToSpec && (
        <div
          className="flex flex-col gap-y-0.5"
          data-testid="line-item-made-to-spec"
        >
          <div className="flex items-center gap-x-2">
            {madeToSpec.color_hex && (
              <span
                className="border-ui-border-base size-3 shrink-0 rounded-full border"
                style={{ backgroundColor: madeToSpec.color_hex }}
                aria-hidden
              />
            )}
            <Text className="txt-small text-ui-fg-subtle">
              Made to order
              {madeToSpec.color_name ? ` — ${madeToSpec.color_name}` : ""}
              {madeToSpec.lead_time_days
                ? ` · about ${madeToSpec.lead_time_days} days`
                : ""}
            </Text>
          </div>
          {/* The partner-defined choices — "Color Pattern", "Embroidery".
            *  Shown as label AND value: "Kashida — cuff and pallu" alone does
            *  not say which question it answered, and on an order that is the
            *  difference between a record and a riddle. */}
          {!!madeToSpec.options?.length && (
            <div className="flex flex-col gap-y-0.5">
              {madeToSpec.options.map((option) => (
                <Text
                  key={option.key}
                  className="txt-small text-ui-fg-subtle"
                  data-testid="line-item-spec-option"
                >
                  {option.label}: {option.value}
                </Text>
              ))}
            </div>
          )}

          {madeToSpec.weave && (
            <Text className="txt-small text-ui-fg-muted">
              {madeToSpec.weave}
            </Text>
          )}
          {madeToSpec.note && (
            <Text className="txt-small text-ui-fg-muted italic">
              “{madeToSpec.note}”
            </Text>
          )}
        </div>
      )}
    </div>
  )
}

export default LineItemOptions
