import { Heading, Text } from "@medusajs/ui"

import { convertToLocale } from "@lib/util/money"

import type { QuoteView } from "@lib/data/quotes"
import QuoteAcceptPanel from "../components/quote-accept"
import QuoteAssuranceSection from "../components/quote-assurance"
import QuoteHowItWorks from "../components/quote-how-it-works"
import QuoteLines from "../components/quote-lines"
import QuotePartiesBlock from "../components/quote-parties"
import QuoteMakerSection from "../components/quote-producer"
import QuoteRetailSection from "../components/quote-retail"
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
const QuoteTemplate = ({
  quote,
  token,
  countryCode,
}: {
  quote: QuoteView
  token: string
  countryCode: string
}) => {
  const { compare, recipient, producer, provenance, parties, acceptance, retail, assurance } =
    quote

  /**
   * The real split, so the wizard's last step says the numbers rather than "a
   * deposit". Only when the backend actually computed them — a guide that
   * invents a percentage is worse than a generic sentence.
   */
  const depositLine =
    acceptance?.deposit_amount !== null && acceptance?.deposit_amount !== undefined
      ? `Accepting turns this quote into an order and takes you to checkout. You pay ${acceptance.deposit_pct}% now (${convertToLocale({ amount: acceptance.deposit_amount, currency_code: acceptance.currency_code })}) and the balance before dispatch.`
      : null

  return (
    <div className="content-container py-12 max-w-4xl">
      <div className="flex flex-col gap-y-2">
        <Heading level="h1" className="text-2xl-semi text-ui-fg-base">
          {compare.headline}
        </Heading>
        <Text className="text-ui-fg-subtle">{compare.explanation}</Text>
      </div>

      {/* Both parties and their registrations — the two questions finance asks
          of any quote it is sent. Falls back to the recipient-only card for a
          quote minted before `parties` existed. */}
      {parties ? (
        <QuotePartiesBlock parties={parties} partnerNote={recipient.partner_note} />
      ) : (recipient.name || recipient.company) ? (
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
      ) : null}

      {/* Above the prices. Almost everyone opening this link is opening their
          first, and "is this a bill?" has to be answered before the numbers. */}
      <QuoteHowItWorks token={token} depositLine={depositLine} />

      {/* Whose hands make this. Rendered only when the backend says so — on the
          partner's own domain the partner IS the seller and naming them again
          is noise, so `producer` is null there. */}
      <QuoteMakerSection producer={producer} provenance={provenance} />

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

      {/* Directly under the money. A buyer who has just read the total is at
          the moment of deciding; making them scroll past the maker's history
          to find the button loses them. */}
      {acceptance ? (
        <QuoteAcceptPanel
          token={token}
          acceptance={acceptance}
          countryCode={countryCode}
        />
      ) : null}

      {/* Who made this, and how. Below the money because it is the reason to
          say yes rather than part of the offer, and rendered only when the
          backend has something true to say. */}
      {/* Why here, and the full composition of the number. Below the decision:
          it is the argument, not the offer. */}
      {assurance ? <QuoteAssuranceSection assurance={assurance} /> : null}

      {retail ? <QuoteRetailSection retail={retail} /> : null}

      {compare.disclaimer ? (
        <div className="mt-10 border-t border-ui-border-base pt-6">
          <Text className="txt-small text-ui-fg-muted">{compare.disclaimer}</Text>
        </div>
      ) : null}
    </div>
  )
}

export default QuoteTemplate
