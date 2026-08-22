import { Heading, Text } from "@medusajs/ui"

import { convertToLocale } from "@lib/util/money"
import type { QuoteMoney, QuoteTax, QuoteView } from "@lib/data/quotes"

/**
 * The cost summary — the number this whole feature exists to show.
 *
 * 🔑 Subtotal + freight, quoted as ONE consignment. A buyer comparing suppliers
 * is comparing what they actually pay, which is why freight is a line here and
 * not a footnote.
 *
 * 🔴 It stopped being called "landed cost" on an export. Goods dispatch from
 * India; on a cross-border sale the buyer is importer of record and pays import
 * VAT and customs duty at their own border, neither of which is in this total.
 * A procurement contact who budgets against something labelled "landed" and then
 * meets a customs bill has been misled by us — the #1430 shape, a confident
 * figure that omits a real charge. So the heading says "Quoted total" and
 * `tax.reason` is rendered, not swallowed.
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

/**
 * The tax row, the duty row and the total — or nothing, when there is no number
 * to stand behind.
 *
 * 🔴 The duty row exists because "we pay the duty" used to add nothing to the
 * price (#1447). A DDP quote whose total is silently identical to a non-DDP one
 * is a promise kept out of margin by an amount nobody wrote down; showing it as
 * its own line is what makes the undertaking legible to the buyer AND to us.
 */
const TaxRows = ({
  money,
  tax,
  currency_code,
}: {
  money: QuoteMoney
  tax: QuoteTax
  currency_code: string
}) => {
  if (money.tax_total === null || money.gross_total === null) {
    return null
  }
  const label = tax.rates.length
    ? Array.from(new Set(tax.rates.map((r) => r.name))).join(" + ")
    : "Tax"

  /**
   * One row, three numbers underneath it.
   *
   * `null` on every part means "not a DDP quote"; a `0` part is a real answer
   * and stays in the breakdown, because "duty: nil" is information and a blank
   * is not.
   */
  const ddpParts = [
    money.duty_total !== null
      ? `duty ${convertToLocale({ amount: money.duty_total, currency_code })}`
      : null,
    money.import_tax_total !== null
      ? `import tax ${convertToLocale({ amount: money.import_tax_total, currency_code })}`
      : null,
    money.ddp_fee_total
      ? `clearance ${convertToLocale({ amount: money.ddp_fee_total, currency_code })}`
      : null,
  ].filter(Boolean) as string[]
  const ddpTotal = ddpParts.length
    ? (money.duty_total ?? 0) +
      (money.import_tax_total ?? 0) +
      (money.ddp_fee_total ?? 0)
    : null
  const ddpBreakdown = ddpParts.length > 1 ? ddpParts.join(" · ") : undefined
  return (
    <>
      <Row
        label={tax.inclusive ? `${label} (included)` : label}
        value={convertToLocale({ amount: money.tax_total, currency_code })}
      />
      {ddpTotal !== null ? (
        <Row
          // Named for who pays it, not for what it is: the buyer's question is
          // "is there a customs bill coming", and the answer here is no. The
          // split sits underneath, because a procurement contact reconciling
          // against their own broker's estimate needs to see the parts.
          label="Import duty & taxes (paid by us)"
          value={convertToLocale({ amount: ddpTotal, currency_code })}
          sub={ddpBreakdown}
        />
      ) : null}
      <Row
        label="Total"
        value={convertToLocale({ amount: money.gross_total, currency_code })}
        strong
      />
    </>
  )
}

const Column = ({
  title,
  money,
  tax,
  currency_code,
  freightNote,
  emphasis,
}: {
  title: string
  money: QuoteMoney
  tax: QuoteTax
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
        // "Goods + freight" rather than "Landed": on an export it is neither
        // landed nor final, and the same words have to be true in both cases.
        label="Goods + freight"
        value={convertToLocale({ amount: money.landed_total, currency_code })}
        strong={money.gross_total === null}
      />
      <TaxRows money={money} tax={tax} currency_code={currency_code} />
    </div>
  </div>
)

const QuoteSummary = ({ quote }: { quote: QuoteView }) => {
  const { compare, freight, currency_code, tax } = quote

  // "Landed cost" is only honest when nothing further is charged on arrival.
  const heading =
    tax.status === "calculated" ? "Landed cost" : "Quoted total"

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
        {heading}
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
            tax={tax}
            currency_code={currency_code}
            freightNote={freightNote}
            emphasis
          />
        ) : null}
        {compare.show_live && quote.live ? (
          <Column
            title="Current price"
            money={quote.live}
            tax={tax}
            currency_code={currency_code}
            freightNote={freightNote}
          />
        ) : null}
      </div>

      {/* 🔴 The tax disclosure. Rendered whenever the status is not
          `calculated`, INCLUDING `zero_rated_export` where the zero is real —
          because on an export the sentence about duty is the only warning the
          buyer gets that a customs bill is coming. Dropping it would leave a
          total that looks complete and is not. */}
      {tax.status !== "calculated" && tax.reason ? (
        <Text
          className="txt-small text-ui-fg-subtle rounded-lg border border-ui-border-base bg-ui-bg-subtle p-3"
          data-testid="quote-tax-notice"
        >
          {tax.reason}
        </Text>
      ) : null}

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
