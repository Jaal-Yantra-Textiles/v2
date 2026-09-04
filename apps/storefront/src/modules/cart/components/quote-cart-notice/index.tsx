import { Text, clx } from "@medusajs/ui"

import { convertToLocale } from "@lib/util/money"
import type { QuoteCartTerms } from "types/quote-terms"

/**
 * What a quote-bound cart is, said plainly (#1787).
 *
 * A cart minted by accepting a quote looked exactly like an ordinary basket.
 * A live buyer therefore saw A$314.77 on the cart page, was told nothing about
 * the 30% she was actually being asked for today, and met the split for the
 * first time at the Review step — if she got that far.
 *
 * Two things are worth saying, and this says only those two:
 *
 *   1. **These prices are held.** They came from a quote, they are not the
 *      current shop prices, and they will not move under her.
 *   2. **This is what you pay today, and this is what comes later** — when the
 *      cart is on a deposit.
 *
 * 🔴 Every figure is rendered from the server's `quote_terms`, computed by the
 * same function that decides what the payment collection is created for. This
 * component does no arithmetic beyond formatting. A page that computes its own
 * deposit is how the promise and the charge come to disagree — see the
 * A$94.43-vs-A$314.77 defect this shipped with.
 *
 * ⚠️ Renders nothing at all unless the cart is quote-bound AND there is a real
 * split to show. A quote whose deposit is 100%, or whose deposit has already
 * been paid, has nothing to advertise, and an unavailable/refused plan must
 * fall back to the plain total rather than invent one.
 */
const QuoteCartNotice = ({
  terms,
  className,
}: {
  terms: QuoteCartTerms | null
  className?: string
}) => {
  if (!terms?.is_quote_cart) {
    return null
  }

  const currency = terms.currency_code ?? undefined
  const money = (amount: number | null) =>
    amount === null || !currency
      ? null
      : convertToLocale({ amount, currency_code: currency })

  const depositDue = money(terms.deposit_due_now)
  const balanceLater = money(terms.balance_due_later)
  const hasSplit = Boolean(depositDue && balanceLater)

  const depositPaid = terms.deposit_status === "paid"

  return (
    <div
      className={clx(
        "rounded-lg border border-ui-border-base bg-ui-bg-subtle p-4",
        className
      )}
      data-testid="quote-cart-notice"
    >
      <Text className="txt-medium-plus text-ui-fg-base">
        Priced from your quote
      </Text>
      <Text className="txt-small text-ui-fg-subtle mt-1">
        These prices, and the shipping on them, are the ones you were quoted.
        They are held for this order and will not change here.
      </Text>

      {hasSplit && !depositPaid && (
        <div className="mt-4 flex flex-col gap-y-2 border-t border-ui-border-base pt-4">
          <div className="flex items-center justify-between">
            <Text className="txt-small text-ui-fg-subtle">
              Due today
              {terms.deposit_pct ? ` (${terms.deposit_pct}%)` : ""}
            </Text>
            <Text
              className="txt-medium-plus text-ui-fg-base"
              data-testid="quote-deposit-due"
            >
              {depositDue}
            </Text>
          </div>
          <div className="flex items-center justify-between">
            <Text className="txt-small text-ui-fg-subtle">Due later</Text>
            <Text className="txt-small text-ui-fg-base" data-testid="quote-balance-later">
              {balanceLater}
            </Text>
          </div>
          {/* The balance starts `not_due` on purpose — it is raised on a
              production or delivery event, not at checkout. Saying so stops a
              buyer expecting a second charge tonight. */}
          <Text className="txt-small text-ui-fg-muted mt-1">
            You are charged the amount due today at checkout. The balance is
            requested later, when your order is ready — not now.
          </Text>
        </div>
      )}

      {depositPaid && (
        <Text className="txt-small text-ui-fg-subtle mt-3" data-testid="quote-deposit-paid">
          Your deposit has been received.
        </Text>
      )}
    </div>
  )
}

export default QuoteCartNotice
