import { Text, clx } from "@medusajs/ui"
import Link from "next/link"

import { buildDialHref, type DialledLine } from "@lib/util/quote-lines"
import QuoteQuantityInput from "./input"

/**
 * The +/− control on a quoted line (#1439 S13).
 *
 * ## Two plain links and a box
 *
 * `−` and `+` are anchors to the same page with a different `?lines=`. No
 * state, no fetch, no optimistic number: the server re-prices the entire
 * document — line subtotals, freight for the new weight, the tax band the new
 * goods value falls in, the deposit — and the page that comes back is the only
 * account of what this basket costs. See `lib/util/quote-lines` for why the
 * browser is not allowed to do that arithmetic.
 *
 * 🔑 The box exists because ±1 is useless here. These are bulk quantities —
 * moving 250 to 400 is one edit and 150 clicks. It still only pushes a URL;
 * the server prices it exactly as the links do.
 *
 * ## The floor is 1, not 0
 *
 * The backend reads a dialled 0 as "drop this line", and will refuse a basket
 * dialled empty. But the *view* endpoint keeps a zeroed line and prices it at
 * nothing, so a 0 here would show the buyer a row the cart is going to delete.
 * Rather than reconcile two presentations of an empty line, the control stops
 * at 1 and removing a product stays a conversation with the partner — which is
 * what a buyer dropping an item from a quote does anyway.
 */
const QuoteQuantity = ({
  countryCode,
  token,
  lines,
  variantId,
  quantity,
  quotedQuantity,
}: {
  countryCode: string
  token: string
  /** Every line as the server priced it — the basis for the next href. */
  lines: DialledLine[]
  variantId: string
  quantity: number
  /** What the partner quoted, so a moved line can say so. */
  quotedQuantity: number | null
}) => {
  const href = (next: number) =>
    buildDialHref({ countryCode, token, lines, variantId, quantity: next })

  const canDecrease = quantity > 1

  const stepClass =
    "flex h-8 w-8 items-center justify-center rounded-md border border-ui-border-base text-ui-fg-base transition-colors"

  return (
    <div className="flex flex-col items-end gap-y-1">
      <div className="flex items-center gap-x-1">
        {/* A disabled step is a span, not a dead link: an anchor that goes
            nowhere is still focusable and still announced as a link. */}
        {canDecrease ? (
          <Link
            href={href(quantity - 1)}
            scroll={false}
            prefetch={false}
            aria-label="Decrease quantity by one"
            className={clx(stepClass, "hover:bg-ui-bg-subtle-hover")}
          >
            −
          </Link>
        ) : (
          <span
            aria-hidden="true"
            className={clx(stepClass, "text-ui-fg-disabled bg-ui-bg-disabled")}
          >
            −
          </span>
        )}

        <QuoteQuantityInput
          countryCode={countryCode}
          token={token}
          lines={lines}
          variantId={variantId}
          quantity={quantity}
        />

        <Link
          href={href(quantity + 1)}
          scroll={false}
          prefetch={false}
          aria-label="Increase quantity by one"
          className={clx(stepClass, "hover:bg-ui-bg-subtle-hover")}
        >
          +
        </Link>
      </div>

      {/* What the partner actually quoted, whenever the buyer has moved off it.
          Without this the page silently becomes a different document from the
          one that was sent, and the header still calls it "your quote". */}
      {quotedQuantity !== null && quotedQuantity !== quantity ? (
        <Text className="txt-small text-ui-fg-muted">
          Quoted at {quotedQuantity}
        </Text>
      ) : null}
    </div>
  )
}

export default QuoteQuantity
