import { Heading, Text } from "@medusajs/ui"

import { convertToLocale } from "@lib/util/money"
import type { QuoteRetail } from "@lib/data/quotes"

/**
 * "Can I sell this, and at what?" (#1428 follow-up).
 *
 * A wholesale buyer's next question after the price is always the same one:
 * what does this go out at. The shop's own list price is a fact we hold, and
 * showing it beside theirs answers it without anybody having to ask.
 *
 * 🔴 A list price is what WE sell at — a reference point, not a promise of
 * resale value, and the footnote says exactly that. The backend returns null
 * for the whole block where there is no positive spread, so this component can
 * never render a margin of 0%: that would read as "not worth reselling", a
 * conclusion nobody here is entitled to draw on the buyer's behalf.
 *
 * A line whose list price could not be resolved shows an em-dash in the list
 * column ONLY — the buyer must be able to see which item we could not price
 * rather than reading it as a zero-margin one.
 */
const QuoteRetailSection = ({ retail }: { retail: QuoteRetail }) => {
  const money = (amount: number | null) =>
    amount === null || amount === undefined
      ? "—"
      : convertToLocale({ amount, currency_code: retail.currency_code })

  return (
    <section className="mt-10">
      <Heading level="h2" className="text-xl-semi text-ui-fg-base mb-1">
        What this sells for
      </Heading>
      <Text className="txt-small text-ui-fg-subtle">
        Our own shop price beside yours, so you can see the room you have.
      </Text>

      {retail.tags.length ? (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {retail.tags.map((tag) => (
            <li
              key={tag}
              className="rounded-full border border-ui-border-base bg-ui-bg-subtle px-2.5 py-1 txt-small text-ui-fg-subtle"
            >
              {tag}
            </li>
          ))}
        </ul>
      ) : null}

      {/* Scrolls on a phone rather than squeezing four money columns into
          320px, which is how a number gets misread. */}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[520px] text-left">
          <thead>
            <tr className="border-b border-ui-border-base">
              <th className="py-2 pr-4 txt-small text-ui-fg-muted font-normal">
                Item
              </th>
              <th className="py-2 pr-4 txt-small text-ui-fg-muted font-normal text-right">
                Your price
              </th>
              <th className="py-2 pr-4 txt-small text-ui-fg-muted font-normal text-right">
                Sells at
              </th>
              <th className="py-2 txt-small text-ui-fg-muted font-normal text-right">
                Your room
              </th>
            </tr>
          </thead>
          <tbody>
            {retail.lines.map((line) => (
              <tr
                key={line.variant_id}
                className="border-b border-ui-border-base last:border-b-0"
              >
                <td className="py-3 pr-4 txt-medium text-ui-fg-base">
                  {line.product_title ?? "Item"}
                </td>
                <td className="py-3 pr-4 txt-medium text-ui-fg-base text-right">
                  {money(line.unit_amount)}
                </td>
                <td className="py-3 pr-4 txt-medium text-ui-fg-subtle text-right">
                  {money(line.list_unit_amount)}
                </td>
                <td className="py-3 txt-medium text-ui-fg-base text-right">
                  {line.unit_margin === null ? (
                    "—"
                  ) : (
                    <>
                      {money(line.unit_margin)}
                      <span className="txt-small text-ui-fg-subtle">
                        {" "}
                        ({line.margin_pct}%)
                      </span>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {retail.total_margin !== null ? (
        <div className="mt-4 flex flex-col gap-y-1 rounded-lg bg-ui-bg-subtle p-4 small:flex-row small:items-center small:justify-between">
          <Text className="txt-small text-ui-fg-subtle">
            Across this basket, at the quantities quoted
          </Text>
          <Text className="txt-medium-plus text-ui-fg-base">
            {money(retail.total_margin)}
            {retail.margin_pct !== null ? (
              <span className="txt-small text-ui-fg-subtle">
                {" "}
                ({retail.margin_pct}%)
              </span>
            ) : null}
          </Text>
        </div>
      ) : null}

      <Text className="txt-small text-ui-fg-muted mt-3">
        &ldquo;Sells at&rdquo; is our own shop price for a single unit today. It
        is a reference, not a resale price you are committed to or guaranteed.
      </Text>
    </section>
  )
}

export default QuoteRetailSection
