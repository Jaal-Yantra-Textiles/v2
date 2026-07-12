import { clx } from "@medusajs/ui"
import { Clock, Sparkles } from "@medusajs/icons"
import { ArtisanDetail, formatLeadTime } from "./index"

/**
 * Made-to-order reassurance for the buy box (#859 S3 / #862).
 *
 * Styled after the "Fast delivery / Easy returns" inline shipping blocks
 * (icon + bold label + subtle copy) so it reads as a native trust signal.
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
        "text-small-regular flex flex-col gap-y-4 rounded-lg border border-ui-border-base bg-ui-bg-subtle p-4",
        className
      )}
    >
      <div className="flex items-start gap-x-2">
        <Sparkles className="mt-0.5 flex-shrink-0 text-ui-fg-subtle" />
        <div>
          <span className="font-semibold">Made to order</span>
          <p className="max-w-sm text-ui-fg-subtle">
            This piece is crafted for you once you order — not held in stock, so
            each one is made just for you.
          </p>
        </div>
      </div>
      {leadTime && (
        <div className="flex items-start gap-x-2">
          <Clock className="mt-0.5 flex-shrink-0 text-ui-fg-subtle" />
          <div>
            <span className="font-semibold">Preparation time</span>
            <p className="max-w-sm text-ui-fg-subtle">
              {leadTime}. We&apos;ll keep you posted as your piece comes together.
            </p>
          </div>
        </div>
      )}
      {minQty && (
        <p className="text-ui-fg-subtle">Minimum order: {minQty}</p>
      )}
    </div>
  )
}
