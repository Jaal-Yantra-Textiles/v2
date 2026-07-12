import { clx } from "@medusajs/ui"
import { Sparkles } from "@medusajs/icons"
import { ArtisanDetail, formatLeadTime } from "./index"

/**
 * Made-to-order reassurance for the buy box (#859 S3 / #862).
 *
 * Editorial artisan-info treatment: an uppercase eyebrow + prose sitting under a
 * hairline divider — deliberately NOT the bordered "Fast delivery / Easy returns"
 * shipping card, so it reads as provenance, not a shipping trust badge.
 * Rendered only when the partner marked the product made-to-order.
 */
export default function MadeToOrderNotice({
  detail,
  className,
}: {
  detail: ArtisanDetail | null
  className?: string
}) {
  if (!detail?.made_to_order) return null

  const leadTime = formatLeadTime(detail)
  const minQty =
    detail.min_order_quantity && detail.min_order_quantity > 1
      ? detail.min_order_quantity
      : null

  return (
    <div
      data-testid="made-to-order-notice"
      className={clx(
        "flex flex-col gap-y-3 border-t border-ui-border-base pt-6",
        className
      )}
    >
      <div className="flex items-center gap-x-1.5 text-ui-fg-muted">
        <Sparkles className="h-3.5 w-3.5 flex-shrink-0" />
        <span className="text-xs uppercase tracking-wider">Made to order</span>
      </div>
      <p className="text-small-regular max-w-sm text-ui-fg-subtle">
        This piece is crafted for you once you order — not held in stock, so each
        one is made just for you.
      </p>
      {(leadTime || minQty) && (
        <dl className="text-small-regular flex flex-col gap-y-1">
          {leadTime && (
            <div className="flex gap-x-2">
              <dt className="text-ui-fg-muted">Preparation time</dt>
              <dd className="text-ui-fg-subtle">{leadTime}</dd>
            </div>
          )}
          {minQty && (
            <div className="flex gap-x-2">
              <dt className="text-ui-fg-muted">Minimum order</dt>
              <dd className="text-ui-fg-subtle">{minQty}</dd>
            </div>
          )}
        </dl>
      )}
    </div>
  )
}
