import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { BOT_SUPPRESSED_SEND_ID } from "../../lib/bot-recipients"
import { PARTNER_QUOTE_MODULE } from "../../modules/partner-quote"
import { PARTNER_QUOTE_EVENTS } from "../../modules/partner-quote/events"
import { buildQuoteEmailData } from "../../modules/partner-quote/lib/quote-email"
import { resolveQuoteBuyerLink } from "../../modules/partner-quote/lib/quote-link"
import { sendQuoteEmailWorkflow } from "../email/workflows/send-quote-email"
import { sendQuoteIntroductionEmailWorkflow } from "../email/workflows/send-quote-introduction-email"

/**
 * Send the minted quote to its buyer (#1420), and say honestly whether it
 * went. Introduce the partner first (#1486) — in code, not in a flow.
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
    /**
     * Pieces across every line. Distinct from `lineCount`, which is how many
     * ROWS the quote has — the two were conflated in both emails' copy until
     * a six-line quote for ten pieces introduced itself as "6 item(s)".
     */
    totalQuantity: number
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

  /**
   * Announce the mint so a VISUAL FLOW can act on it.
   *
   * 🔑 The quote path emitted NOTHING, which is why no flow could send an
   * introduction before the quote: there was no event in the system to trigger
   * on. A flow can now listen for `partner_quote.minted` and do the sequencing
   * — introduce the partner, wait, then send the link — without any of that
   * being hard-coded here.
   *
   * Emitted BEFORE the send and regardless of whether it succeeds: a flow is
   * exactly the right thing to recover a failed delivery, so it must hear
   * about the quote even when the built-in mail does not go. The payload
   * carries `buyer_url` because a flow that cannot name the link can send
   * nothing useful.
   *
   * 🔴 Never allowed to fail a mint. A flow is an addition to the quote, not a
   * precondition for it — the same rule `recordEvent` follows.
   */
  try {
    const eventBus: any = scope.resolve(Modules.EVENT_BUS)
    await eventBus.emit({
      name: PARTNER_QUOTE_EVENTS.MINTED,
      data: {
        id: quote?.id,
        quote_id: quote?.id,
        partner_id: quote?.partner_id ?? null,
        partner_name: input.partnerName ?? null,
        buyer_email: to,
        buyer_url: buyerUrl,
        recipient_name: quote?.recipient_name ?? null,
        recipient_company: quote?.recipient_company ?? null,
        currency_code: quote?.currency_code ?? null,
        total: quote?.quoted_landed_total ?? null,
        destination_country_code: quote?.destination_country_code ?? null,
        line_count: input.lineCount,
        /**
         * 🔑 The pieces, for any visual flow that renders a number to a buyer.
         * Without it the introduction email had only `line_count` to reach for
         * and no way to be right — the payload simply did not carry the
         * quantity, so no amount of editing the template could have fixed it.
         */
        total_quantity: input.totalQuantity,
        actor_type: input.actorType,
      },
    })
  } catch (e: any) {
    logger.warn(
      `[quote] could not emit partner_quote.minted for ${quote?.id}: ${e?.message ?? String(e)}`
    )
  }

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
      "this partner has no storefront of their own, and a link on the house domain would 404 — " +
        "the quote can only be read through its own store's key. Provision a storefront for the partner, " +
        "or mint under one that has one.",
      "email_skipped"
    )
  }

  const quoteEmailData = buildQuoteEmailData({
    quote,
    partnerName: input.partnerName ?? null,
    quoteUrl: buyerUrl,
    lineCount: input.lineCount,
    totalQuantity: input.totalQuantity,
    now: new Date(),
  })

  /**
   * Introduce the partner BEFORE the quote (#1486 slice 1).
   *
   * 🔴 This used to be delegated to a prod-configured visual flow listening on
   * `partner_quote.minted` — and nothing in code ever sent it, so whether a
   * buyer was introduced at all depended on infrastructure nobody had
   * reviewed. It is sent here, in code, from the delivery path instead.
   *
   * ## Ordering is the point, and it is real
   *
   * Awaited, not fired and forgotten: the introduction's copy says "your
   * quote follows shortly", and a quote that lands first — or concurrently —
   * makes that a lie. Only after this resolves, one way or the other, does
   * the quote send below run.
   *
   * ## A failed introduction must never cost the buyer their link
   *
   * The quote email is the only durable copy of the token; the introduction
   * is a courtesy. So the failure is logged loudly — partner id, buyer email
   * and the error, because "the introduction did not go" is a fact a human
   * should be able to act on — and swallowed. The quote send then proceeds
   * exactly as it would have.
   *
   * 🔑 No dedup yet (#1486 slice 1b, deliberately out of scope here): a visual
   * flow configured on `partner_quote.minted` may still send its own
   * introduction, and a buyer can be introduced once per quote. Making it
   * once-per-(partner, buyer) needs a table this code does not have yet.
   */
  try {
    const { result } = await sendQuoteIntroductionEmailWorkflow(scope).run({
      input: {
        email: to,
        data: {
          // The same builder as the quote email, so the two cannot disagree
          // about who the partner is or how the destination reads.
          partner_name: quoteEmailData.partner_name,
          recipient_name: quoteEmailData.recipient_name,
          recipient_company:
            String(quote?.recipient_company ?? "").trim() || null,
          line_count: quoteEmailData.line_count,
          total_quantity: quoteEmailData.total_quantity,
          destination: quoteEmailData.destination,
          current_year: quoteEmailData.current_year,
        },
      },
    })

    if ((result as any)?.id === BOT_SUPPRESSED_SEND_ID) {
      // Not an error: nothing was lost, and the quote send right after will
      // report the crawler address loudly as ITS failure. But "delivered"
      // would be a lie — a suppressed send must never read as sent (#1333).
      logger.warn(
        `[quote] introduction suppressed (known crawler address) quote=${quote.id} to=${to}`
      )
    } else {
      logger.info(`[quote] introduction delivered quote=${quote.id} to=${to}`)
    }
  } catch (e: any) {
    logger.error(
      `[quote] introduction NOT delivered quote=${quote?.id} partner_id=${quote?.partner_id ?? null} to=${to}: ${e?.message ?? String(e)}`
    )
  }

  try {
    const { result } = await sendQuoteEmailWorkflow(scope).run({
      input: {
        email: to,
        data: quoteEmailData,
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
