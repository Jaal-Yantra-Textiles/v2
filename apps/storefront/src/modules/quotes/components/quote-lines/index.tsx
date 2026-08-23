import { Text } from "@medusajs/ui"

import { convertToLocale } from "@lib/util/money"
import type { DialledLine } from "@lib/util/quote-lines"
import { buildQuotedHref } from "@lib/util/quote-lines"
import type { QuoteView, QuoteViewLine } from "@lib/data/quotes"
import QuoteLineImage from "../quote-image"
import QuoteLineSpecRows from "../quote-line-spec"
import QuoteQuantity from "../quote-quantity"

/**
 * The quoted basket, line by line.
 *
 * 🔑 Which columns appear is the BACKEND's decision (`compare.show_quoted` /
 * `show_live`), not this component's. A dead link, a pre-freeze quote and a
 * quote whose live price has moved are three different documents, and the rule
 * that tells them apart lives in `compare.ts` alongside the headline and the
 * disclaimer. Re-deriving it here would give the page and its own explanation
 * two different opinions.
 */
const money = (amount: number | null | undefined, currency_code: string) =>
  amount === null || amount === undefined
    ? "—"
    : convertToLocale({ amount, currency_code })

const LineRow = ({
  line,
  currency_code,
  showQuoted,
  showLive,
  dial,
}: {
  line: QuoteViewLine
  currency_code: string
  showQuoted: boolean
  showLive: boolean
  /** Absent ⇒ the quantity is stated, not offered. */
  dial: {
    token: string
    countryCode: string
    lines: DialledLine[]
  } | null
}) => (
  <tr className="border-b border-ui-border-base last:border-b-0">
    <td className="py-4 pr-4 align-top">
      <div className="flex gap-x-4">
        {/* 🔴 No placeholder photo. A plausible WRONG image on a quote is worse
            than an empty cell — the buyer is agreeing to *that* item. The box
            is reserved either way so the rows stay aligned. */}
        {line.thumbnail ? (
          <QuoteLineImage
            src={line.thumbnail}
            alt={line.product_title ?? "Quoted item"}
            caption={
              [line.product_title, line.variant_title].filter(Boolean).join(" — ") ||
              null
            }
          />
        ) : null}
        <div className="min-w-0">
          <Text className="txt-medium-plus text-ui-fg-base">
            {line.product_title ?? "Product"}
          </Text>
          {line.variant_title ? (
            <Text className="txt-small text-ui-fg-subtle">{line.variant_title}</Text>
          ) : null}
          {line.note ? (
            <Text className="txt-small text-ui-fg-muted italic mt-1">{line.note}</Text>
          ) : null}
          {/* A declared PRODUCT weight over-quotes a lighter variant, and at bulk
              quantities that can cross a carrier slab — so where the weight came
              from travels with the number rather than being buried. */}
          {line.weight_source === "product" ? (
            <Text className="txt-small text-ui-fg-muted mt-1">
              Weight estimated from the product, not this variant.
            </Text>
          ) : null}
          {/* A PRODUCT thumbnail on a variant-specific line is a weaker claim than
              the variant's own photo, so it is captioned rather than passed off. */}
          {line.image_source === "product" ? (
            <Text className="txt-small text-ui-fg-muted mt-1">
              Image shows the product; this variant may differ.
            </Text>
          ) : null}
          {line.spec ? <QuoteLineSpecRows spec={line.spec} /> : null}
        </div>
      </div>
    </td>
    <td className="py-4 px-4 align-top text-right whitespace-nowrap">
      {dial ? (
        <QuoteQuantity
          countryCode={dial.countryCode}
          token={dial.token}
          lines={dial.lines}
          variantId={line.variant_id}
          quantity={line.quantity}
          quotedQuantity={line.quoted_quantity ?? null}
        />
      ) : (
        <Text className="txt-medium text-ui-fg-base">{line.quantity}</Text>
      )}
    </td>
    {showQuoted ? (
      <td className="py-4 px-4 align-top text-right whitespace-nowrap">
        <Text className="txt-medium text-ui-fg-base">
          {money(line.quoted_unit_amount, currency_code)}
        </Text>
        <Text className="txt-small text-ui-fg-subtle">
          {money(line.quoted_subtotal, currency_code)}
        </Text>
      </td>
    ) : null}
    {showLive ? (
      <td className="py-4 pl-4 align-top text-right whitespace-nowrap">
        <Text className="txt-medium text-ui-fg-base">
          {money(line.live_unit_amount, currency_code)}
        </Text>
        <Text className="txt-small text-ui-fg-subtle">
          {money(line.live_subtotal, currency_code)}
        </Text>
      </td>
    ) : null}
  </tr>
)

const QuoteLines = ({
  quote,
  token,
  countryCode,
}: {
  quote: QuoteView
  token: string
  countryCode: string
}) => {
  const { show_quoted: showQuoted, show_live: showLive } = quote.compare
  const lines = [...quote.lines].sort((a, b) => a.position - b.position)

  /**
   * Quantities are only OFFERED while the quote is still something the buyer
   * can act on (#1439 S13).
   *
   * Once accepted, the cart exists and its quantities are fixed — a stepper
   * that re-prices this page would show a basket the order will not match, and
   * the buyer would have no way to tell which of the two was real. A blocked
   * quote stays dialable on purpose: "what would 400 cost" is exactly the
   * question that gets answered by replying to the partner.
   */
  const dial = quote.acceptance?.accepted
    ? null
    : {
        token,
        countryCode,
        lines: lines.map((l) => ({
          variant_id: l.variant_id,
          quantity: l.quantity,
        })),
      }

  // Whether the buyer has moved anything off the quoted basket. Drives the one
  // sentence that stops a dialled page passing itself off as the partner's
  // offer — the totals below it are real, but nobody quoted them.
  const dialled = lines.some(
    (l) => l.quoted_quantity !== null && l.quoted_quantity !== undefined && l.quoted_quantity !== l.quantity
  )

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem]">
        <thead>
          <tr className="border-b border-ui-border-strong">
            <th className="py-3 pr-4 text-left">
              <Text className="txt-small-plus text-ui-fg-subtle">Item</Text>
            </th>
            <th className="py-3 px-4 text-right">
              <Text className="txt-small-plus text-ui-fg-subtle">Qty</Text>
            </th>
            {showQuoted ? (
              <th className="py-3 px-4 text-right">
                <Text className="txt-small-plus text-ui-fg-subtle">Quoted</Text>
              </th>
            ) : null}
            {showLive ? (
              <th className="py-3 pl-4 text-right">
                <Text className="txt-small-plus text-ui-fg-subtle">Current</Text>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <LineRow
              key={line.variant_id}
              line={line}
              currency_code={quote.currency_code}
              showQuoted={showQuoted}
              showLive={showLive}
              dial={dial}
            />
          ))}
        </tbody>
      </table>

      {/* 🔴 Said once, under the lines rather than beside one of them: the
          document is no longer the one that was sent. The prices are the
          partner's and the server computed every total on this page from these
          quantities — but the quantities are the buyer's, and a page headed
          "your quote" must not let that pass unremarked. */}
      {dialled ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md border border-ui-border-base bg-ui-bg-subtle px-4 py-3">
          <Text className="txt-small text-ui-fg-subtle">
            You have changed the quantities. These prices are your partner&apos;s,
            re-applied to the basket above.
          </Text>
          <a
            href={buildQuotedHref({ countryCode, token })}
            className="txt-small-plus text-ui-fg-interactive hover:text-ui-fg-interactive-hover"
          >
            Back to the quoted quantities
          </a>
        </div>
      ) : null}
    </div>
  )
}

export default QuoteLines
