import { Heading, Text } from "@medusajs/ui"

import { convertToLocale } from "@lib/util/money"
import type { QuoteMoney, QuoteView } from "@lib/data/quotes"

/**
 * The landed-cost summary — the number this whole feature exists to show.
 *
 * 🔑 "Landed" is the point: subtotal + freight, quoted as ONE consignment. A
 * buyer comparing suppliers is comparing what they actually pay, which is why
 * freight is a line here and not a footnote.
 */
const Row = ({
  label,
  value,
  strong,
  sub,
}: {
  label: string
  value: string
  strong?: boolean
  sub?: string
}) => (
  <div className="flex items-start justify-between gap-4 py-2">
    <div>
      <Text
        className={
          strong ? "txt-medium-plus text-ui-fg-base" : "txt-medium text-ui-fg-subtle"
        }
      >
        {label}
      </Text>
      {sub ? <Text className="txt-small text-ui-fg-muted">{sub}</Text> : null}
    </div>
    <Text
      className={
        strong
          ? "txt-medium-plus text-ui-fg-base whitespace-nowrap"
          : "txt-medium text-ui-fg-base whitespace-nowrap"
      }
    >
      {value}
    </Text>
  </div>
)

const Column = ({
  title,
  money,
  currency_code,
  freightNote,
  emphasis,
}: {
  title: string
  money: QuoteMoney
  currency_code: string
  freightNote?: string
  emphasis?: boolean
}) => (
  <div
    className={`flex flex-col rounded-lg border p-5 ${
      emphasis
        ? "border-ui-border-interactive bg-ui-bg-subtle"
        : "border-ui-border-base"
    }`}
  >
    <Text className="txt-small-plus text-ui-fg-subtle uppercase tracking-wide">
      {title}
    </Text>
    <div className="mt-3 divide-y divide-ui-border-base">
      <Row
        label="Subtotal"
        value={convertToLocale({ amount: money.subtotal, currency_code })}
      />
      <Row
        label="Freight"
        value={convertToLocale({ amount: money.freight, currency_code })}
        sub={freightNote}
      />
      <Row
        label="Landed total"
        value={convertToLocale({ amount: money.landed_total, currency_code })}
        strong
      />
    </div>
  </div>
)

const QuoteSummary = ({ quote }: { quote: QuoteView }) => {
  const { compare, freight, currency_code } = quote

  const freightNote = freight.chosen
    ? [
        freight.chosen.courier_name || freight.chosen.name,
        freight.chosen.estimated_days
          ? `~${freight.chosen.estimated_days} days`
          : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : undefined

  return (
    <div className="flex flex-col gap-y-4">
      <Heading level="h2" className="text-xl-semi text-ui-fg-base">
        Landed cost
      </Heading>

      <div
        className={`grid gap-4 ${
          compare.show_quoted && compare.show_live
            ? "grid-cols-1 sm:grid-cols-2"
            : "grid-cols-1"
        }`}
      >
        {compare.show_quoted && quote.quoted ? (
          <Column
            title="Quoted for you"
            money={quote.quoted}
            currency_code={currency_code}
            freightNote={freightNote}
            emphasis
          />
        ) : null}
        {compare.show_live && quote.live ? (
          <Column
            title="Current price"
            money={quote.live}
            currency_code={currency_code}
            freightNote={freightNote}
          />
        ) : null}
      </div>

      {/* Freight is an ESTIMATE and says so. Carrier rates move, and the manual
          tier is a placeholder the partner is expected to edit — presenting it
          as final would be the one number on this page we cannot stand behind. */}
      {freight.error ? (
        <Text className="txt-small text-ui-fg-muted">
          Freight could not be quoted live for this lane, so the figure above is
          an indicative rate.
        </Text>
      ) : null}

      {quote.total_weight_grams ? (
        <Text className="txt-small text-ui-fg-muted">
          Quoted as one consignment of{" "}
          {(quote.total_weight_grams / 1000).toFixed(2)} kg to{" "}
          {quote.destination_country_code?.toUpperCase()}
          {quote.destination_postal_code
            ? ` ${quote.destination_postal_code}`
            : ""}
          .
        </Text>
      ) : null}
    </div>
  )
}

export default QuoteSummary
