import { Text } from "@medusajs/ui"
import Image from "next/image"

import { convertToLocale } from "@lib/util/money"
import type { QuoteView, QuoteViewLine } from "@lib/data/quotes"
import QuoteLineSpecRows from "../quote-line-spec"

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
}: {
  line: QuoteViewLine
  currency_code: string
  showQuoted: boolean
  showLive: boolean
}) => (
  <tr className="border-b border-ui-border-base last:border-b-0">
    <td className="py-4 pr-4 align-top">
      <div className="flex gap-x-4">
        {/* 🔴 No placeholder photo. A plausible WRONG image on a quote is worse
            than an empty cell — the buyer is agreeing to *that* item. The box
            is reserved either way so the rows stay aligned. */}
        {line.thumbnail ? (
          <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md bg-ui-bg-subtle">
            <Image
              src={line.thumbnail}
              alt={line.product_title ?? "Quoted item"}
              fill
              sizes="64px"
              quality={60}
              className="object-cover object-center"
            />
          </div>
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
      <Text className="txt-medium text-ui-fg-base">{line.quantity}</Text>
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

const QuoteLines = ({ quote }: { quote: QuoteView }) => {
  const { show_quoted: showQuoted, show_live: showLive } = quote.compare
  const lines = [...quote.lines].sort((a, b) => a.position - b.position)

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
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default QuoteLines
