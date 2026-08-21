import { Heading, Text } from "@medusajs/ui"

import type { QuoteView } from "@lib/data/quotes"
import QuoteLines from "../components/quote-lines"
import QuoteSummary from "../components/quote-summary"

/**
 * The buyer's quote page (#1389 S4).
 *
 * There is no login and no account. The token in the URL is the whole
 * credential, because asking a procurement contact to sign up before they can
 * see a price is the wall this feature exists to remove.
 *
 * 🔑 Every judgement on this page — the headline, what the buyer is looking at,
 * the disclaimer, the expiry nudge, which price columns exist — comes from the
 * backend's `compare` block. This template renders those decisions; it does not
 * re-make them. Two opinions about whether a quote is stale is how a page ends
 * up contradicting its own header.
 */
const QuoteTemplate = ({ quote }: { quote: QuoteView }) => {
  const { compare, recipient } = quote

  return (
    <div className="content-container py-12 max-w-4xl">
      <div className="flex flex-col gap-y-2">
        <Heading level="h1" className="text-2xl-semi text-ui-fg-base">
          {compare.headline}
        </Heading>
        <Text className="text-ui-fg-subtle">{compare.explanation}</Text>
      </div>

      {(recipient.name || recipient.company) && (
        <div className="mt-6 rounded-lg border border-ui-border-base p-5">
          <Text className="txt-small-plus text-ui-fg-subtle uppercase tracking-wide">
            Prepared for
          </Text>
          <Text className="txt-medium-plus text-ui-fg-base mt-1">
            {recipient.company || recipient.name}
          </Text>
          {recipient.company && recipient.name ? (
            <Text className="txt-small text-ui-fg-subtle">{recipient.name}</Text>
          ) : null}
          {recipient.partner_note ? (
            <Text className="txt-medium text-ui-fg-subtle mt-3 whitespace-pre-line">
              {recipient.partner_note}
            </Text>
          ) : null}
        </div>
      )}

      {/* Amber, and above the prices rather than below them: a buyer who scrolls
          no further still needs to know the clock is running. */}
      {compare.expiry_notice ? (
        <div className="mt-6 rounded-lg border border-ui-tag-orange-border bg-ui-tag-orange-bg p-4">
          <Text className="txt-medium text-ui-tag-orange-text">
            {compare.expiry_notice}
          </Text>
        </div>
      ) : null}

      <div className="mt-10">
        <Heading level="h2" className="text-xl-semi text-ui-fg-base mb-2">
          Your basket
        </Heading>
        <QuoteLines quote={quote} />
      </div>

      <div className="mt-10">
        <QuoteSummary quote={quote} />
      </div>

      {compare.disclaimer ? (
        <div className="mt-10 border-t border-ui-border-base pt-6">
          <Text className="txt-small text-ui-fg-muted">{compare.disclaimer}</Text>
        </div>
      ) : null}
    </div>
  )
}

export default QuoteTemplate
