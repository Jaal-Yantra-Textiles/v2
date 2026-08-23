import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { BOT_SUPPRESSED_SEND_ID } from "../../lib/bot-recipients"
import { PARTNER_QUOTE_MODULE } from "../../modules/partner-quote"
import { buildQuoteEmailData } from "../../modules/partner-quote/lib/quote-email"
import { resolveQuoteBuyerLink } from "../../modules/partner-quote/lib/quote-link"
import { sendQuoteEmailWorkflow } from "../email/workflows/send-quote-email"

/**
 * Send the minted quote to its buyer (#1420), and say honestly whether it went.
 *
 * ## Why this sits beside the mint rather than inside it
 *
 * `mintQuoteWorkflow` deliberately does not send: freeze first, so a mail can
 * never describe a row that was rolled back. But that leaves the send with no
 * owner, and two mint routes needing identical behaviour — which in this
 * codebase is how one of them quietly ends up different (the partner sidebar's
 * Orders items were written three times and the entry was added to two).
 * One function, both routes.
 *
 * ## Why a failed send is reported, not thrown
 *
 * 🔴 The raw token is in the caller's hand and NOWHERE else. Throwing here
 * would turn a delivery failure into a 500 whose body never reaches the
 * caller, destroying the only copy of a link to a quote that already minted a
 * live price list. So this never throws: it returns a verdict, logs loudly at
 * error, and writes the failure to the quote's own timeline. The caller still
 * returns 201 with the token, and the UI tells the human to send it by hand.
 *
 * ## The suppression trap
 *
 * Every provider silently returns `BOT_SUPPRESSED_SEND_ID` for a known crawler
 * address without mailing anything (#1333). For cart recovery that is the
 * point. Here it would report a quote as delivered whose link was never sent,
 * so it is treated as a failure — the one case where "we chose not to mail
 * this" and "the buyer has their quote" must not collapse into the same true.
 */
export type QuoteEmailDelivery = {
  /** True only when a provider accepted a real message. */
  sent: boolean
  /** The address it was addressed to, whether or not it went. */
  to: string | null
  /** The buyer link, so the caller can show it even when the send failed. */
  buyer_url: string | null
  /** Why it did not go. Null on success. Shown to a human, so plain words. */
  reason: string | null
}

export async function deliverQuoteEmail(
  scope: any,
  input: {
    quote: any
    token: string | null | undefined
    partnerName?: string | null
    lineCount: number
    /** Who is being told, for the timeline. */
    actorType: "partner" | "admin"
    actorId?: string | null
  }
): Promise<QuoteEmailDelivery> {
  const logger: any = scope.resolve(ContainerRegistrationKeys.LOGGER)
  const quote = input.quote
  const to = String(quote?.email_sent_to ?? "").trim() || null

  const buyerUrl = await resolveQuoteBuyerLink(scope, {
    partner_id: quote?.partner_id,
    destination_country_code: quote?.destination_country_code,
    token: input.token,
  })

  const fail = async (reason: string, type: string) => {
    // Error, not warn. This is a quote the buyer cannot reach.
    logger.error(
      `[quote] email NOT delivered quote=${quote?.id} to=${to ?? "—"}: ${reason}`
    )
    await recordDeliveryEvent(scope, {
      quoteId: quote?.id,
      type,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      message: `The quote email was not delivered: ${reason} Send the link by hand, or mint again.`,
      data: { to, reason, buyer_url: buyerUrl },
    })
    return { sent: false, to, buyer_url: buyerUrl, reason }
  }

  if (!to) {
    return await fail("no buyer email was recorded on the quote.", "email_skipped")
  }

  if (!buyerUrl) {
    // An email without the link is worse than no email: it tells the buyer a
    // quote exists and gives them no way to open it.
    return await fail(
      "this partner has no verified storefront domain, so there is no buyer link to send.",
      "email_skipped"
    )
  }

  try {
    const { result } = await sendQuoteEmailWorkflow(scope).run({
      input: {
        email: to,
        data: buildQuoteEmailData({
          quote,
          partnerName: input.partnerName ?? null,
          quoteUrl: buyerUrl,
          lineCount: input.lineCount,
          now: new Date(),
        }),
      },
    })

    if ((result as any)?.id === BOT_SUPPRESSED_SEND_ID) {
      return await fail(
        "the recipient is a known crawler address and mail to it is suppressed.",
        "email_failed"
      )
    }

    const service: any = scope.resolve(PARTNER_QUOTE_MODULE)
    await service
      .updatePartnerQuotes({ id: quote.id, email_sent_at: new Date() })
      .catch(() => {})

    await recordDeliveryEvent(scope, {
      quoteId: quote.id,
      type: "emailed",
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      message: `The quote link was emailed to ${to}.`,
      data: { to, buyer_url: buyerUrl },
    })

    logger.info(`[quote] email delivered quote=${quote.id} to=${to}`)
    return { sent: true, to, buyer_url: buyerUrl, reason: null }
  } catch (e: any) {
    return await fail(
      String(e?.message ?? e ?? "the mail provider rejected the message."),
      "email_failed"
    )
  }
}

/** Best-effort, like every other write to the timeline. */
async function recordDeliveryEvent(
  scope: any,
  input: {
    quoteId?: string | null
    type: string
    actorType: "partner" | "admin"
    actorId: string | null
    message: string
    data: Record<string, unknown>
  }
) {
  if (!input.quoteId) return
  const service: any = scope.resolve(PARTNER_QUOTE_MODULE)
  await service
    .recordEvent({
      quote_id: input.quoteId,
      type: input.type,
      actor_type: input.actorType,
      actor_id: input.actorId,
      message: input.message,
      data: input.data,
    })
    .catch(() => {})
}
