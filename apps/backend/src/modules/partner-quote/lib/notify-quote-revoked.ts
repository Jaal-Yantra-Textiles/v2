import {
  notifyBuyerOfWithdrawal,
  QUOTE_REVOKED_TEMPLATE,
  type BuyerNotice,
} from "../../../lib/notify-buyer-of-withdrawal"

/**
 * Email the buyer that their quote was withdrawn. Shared by the admin and
 * partner revoke routes so the two cannot drift.
 *
 * Skipped for a re-revoke (`already_revoked`): the buyer was either told the
 * first time or deliberately not, and a second notice adds nothing.
 *
 * The seller's name comes from the partner record, the same name the quote
 * email was signed with, so the withdrawal arrives from whoever sent the quote.
 */
export async function notifyQuoteRevoked(
  scope: any,
  input: {
    quote: any
    alreadyRevoked?: boolean
    notify: unknown
    buyerMessage: unknown
  }
): Promise<BuyerNotice> {
  const quote = input.quote
  const to = String(quote?.email_sent_to ?? "").trim() || null

  if (input.alreadyRevoked) {
    return { sent: false, to, reason: "Not sent: the quote was already revoked." }
  }

  let partnerName: string | null = null
  try {
    const partnerService: any = scope.resolve("partner")
    const partner = quote?.partner_id
      ? await partnerService.retrievePartner(quote.partner_id)
      : null
    partnerName = partner?.name ?? null
  } catch {
    partnerName = null
  }

  const buyerMessage =
    typeof input.buyerMessage === "string" && input.buyerMessage.trim()
      ? input.buyerMessage.trim()
      : null

  return notifyBuyerOfWithdrawal(scope, {
    notify: input.notify,
    to,
    template: QUOTE_REVOKED_TEMPLATE,
    data: {
      quote_id: quote?.id ?? null,
      recipient_name: quote?.recipient_name ?? null,
      partner_name: partnerName || "Jaal Yantra Textiles",
      buyer_message: buyerMessage,
    },
  })
}
