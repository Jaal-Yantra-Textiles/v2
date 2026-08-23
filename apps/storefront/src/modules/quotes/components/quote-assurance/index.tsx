import { Heading, Text } from "@medusajs/ui"

import { convertToLocale } from "@lib/util/money"
import type { QuoteAssurance } from "@lib/data/quotes"

/**
 * Why buy here, and exactly what you pay (#1428 follow-up).
 *
 * 🔴 Every point is gated on a fact by the BACKEND. This component renders what
 * it is given and adds nothing: a "verified" badge that is not backed by a
 * check does not merely mislead one buyer, it empties the word on every
 * workshop that earned it.
 *
 * 🔴 The charge list is the buyer's number, not the maker's terms. The
 * platform's commission with the partner is deliberately absent — publishing it
 * to the partner's own customer hands them the partner's net.
 *
 * The row a reader must not miss is the one that says something is NOT
 * included. It is styled to stand out rather than to blend into a tidy list,
 * because "payable by you on arrival" is the sentence that decides whether a
 * cross-border order is a good deal.
 */
const QuoteAssuranceSection = ({
  assurance,
}: {
  assurance: QuoteAssurance
}) => {
  const money = (amount: number | null) =>
    amount === null || amount === undefined
      ? null
      : convertToLocale({ amount, currency_code: assurance.currency_code })

  if (!assurance.points.length && !assurance.charges.length) return null

  return (
    <section className="mt-10">
      <Heading level="h2" className="text-xl-semi text-ui-fg-base mb-1">
        Buying through us
      </Heading>
      <Text className="txt-small text-ui-fg-subtle">
        {assurance.maker_name
          ? `What we do for you, and what ${assurance.maker_name} charges.`
          : "What we do for you, and what you are charged."}
      </Text>

      {assurance.points.length ? (
        <div className="mt-4 grid grid-cols-1 gap-3 small:grid-cols-2">
          {assurance.points.map((point) => (
            <div
              key={point.key}
              className="rounded-lg border border-ui-border-base p-4"
            >
              <div className="flex items-center gap-x-2">
                {point.key === "verified" ? (
                  <span
                    aria-hidden="true"
                    className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-ui-tag-green-bg text-[11px] text-ui-tag-green-text"
                  >
                    ✓
                  </span>
                ) : null}
                <Text className="txt-medium-plus text-ui-fg-base">
                  {point.title}
                </Text>
              </div>
              <Text className="txt-small text-ui-fg-subtle mt-1">
                {point.body}
              </Text>
            </div>
          ))}
        </div>
      ) : null}

      {assurance.charges.length ? (
        <div className="mt-5 rounded-lg border border-ui-border-base">
          <div className="border-b border-ui-border-base px-4 py-3">
            <Text className="txt-small-plus uppercase tracking-wide text-ui-fg-subtle">
              What you pay
            </Text>
          </div>
          <ul>
            {assurance.charges.map((charge) => (
              <li
                key={charge.key}
                className={`flex flex-col gap-y-1 border-b border-ui-border-base px-4 py-3 last:border-b-0 small:flex-row small:items-baseline small:justify-between small:gap-x-6 ${
                  charge.included ? "" : "bg-ui-tag-orange-bg"
                }`}
              >
                <div className="min-w-0">
                  <Text className="txt-medium text-ui-fg-base">
                    {charge.label}
                  </Text>
                  <Text
                    className={`txt-small ${
                      charge.included
                        ? "text-ui-fg-subtle"
                        : "text-ui-tag-orange-text"
                    }`}
                  >
                    {charge.note}
                  </Text>
                </div>
                <Text className="txt-medium-plus text-ui-fg-base shrink-0 small:text-right">
                  {money(charge.amount) ??
                    (charge.included ? "Included" : "Not included")}
                </Text>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Text
        className={`txt-small mt-3 ${
          assurance.no_further_charges
            ? "text-ui-fg-subtle"
            : "text-ui-tag-orange-text"
        }`}
      >
        {assurance.no_further_charges
          ? "Nothing further is collected on delivery."
          : "Import duty and tax are collected by the carrier when the shipment arrives. Ask us and we will re-quote with those prepaid."}
      </Text>
    </section>
  )
}

export default QuoteAssuranceSection
