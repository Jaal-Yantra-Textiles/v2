import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { PARTNER_QUOTE_MODULE } from "../../../modules/partner-quote"
import { resolveQuoteDesignLines } from "../../../modules/partner-quote/lib/design-lines"
import { buildQuoteListQuery } from "../../../modules/partner-quote/lib/list-query"
import { withEffectiveStatus } from "../../../modules/partner-quote/lib/token"
import { deliverQuoteEmail } from "../../../workflows/partner-quote/deliver-quote-email"
import { mintQuoteWorkflow } from "../../../workflows/partner-quote/mint-quote"
import { getPartnerStore, tryGetPartnerStore } from "../helpers"

/**
 * The partner's own quotes. Scoped by `partner_id`, never listed globally.
 *
 * 🔑 `partner_id` is passed as a PINNED filter, which `buildQuoteListQuery`
 * refuses to let a query string override. The list previously ignored
 * `limit`/`offset` entirely while `usePartnerQuotes` sent them, so the table's
 * pager moved a window over a set that was never windowed and `count` was the
 * length of everything.
 */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { partner, store } = await tryGetPartnerStore(req.auth_context, req.scope)
  if (!store) {
    return res.json({ quotes: [], count: 0 })
  }

  const service: any = req.scope.resolve(PARTNER_QUOTE_MODULE)
  // 🔑 ONE `now` for the filter and the stamp (#1510). Two calls to `new Date()`
  // could straddle an `expires_at`, and a row would be selected as active and
  // then labelled expired in the same response.
  const now = new Date()
  const { filters, config } = buildQuoteListQuery(
    req.query as any,
    { partner_id: partner.id },
    now
  )

  const [quotes, count] = await service.listAndCountPartnerQuotes(
    filters,
    config
  )

  res.json({
    quotes: (quotes ?? []).map((q: any) => withEffectiveStatus(q, now)),
    count,
    limit: config.take,
    offset: config.skip,
  })
}

/**
 * Mint a quote (#1389 S3).
 *
 * 🔑 The raw token is returned HERE and nowhere else — only its sha256 is
 * persisted, so a database read cannot reconstruct a working link. If the
 * caller loses this response, the quote must be re-minted.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { partner, store } = await getPartnerStore(req.auth_context, req.scope)
  const body = req.validatedBody as any

  /**
   * #1486 — a line may name a design instead of a variant. Resolved HERE, not
   * in the workflow, because the two surfaces scope it differently: a partner
   * may only quote designs they own or are assigned to, while an admin quotes
   * across the platform. Resolution throws before anything is created, so a
   * design that cannot be priced costs nothing — the same contract as a variant
   * that does not exist.
   */
  const lines = await resolveQuoteDesignLines(req.scope, {
    lines: body.lines,
    partner_id: partner.id,
  })

  const { result } = await mintQuoteWorkflow(req.scope).run({
    input: {
      partner_id: partner.id,
      store: { id: store.id, default_location_id: store.default_location_id },
      buyer_email: body.buyer_email,
      recipient_name: body.recipient_name ?? null,
      recipient_company: body.recipient_company ?? null,
      // The buyer's own registration, for the document header. It changes no
      // number on the quote — tax follows the seller's jurisdiction (#1447).
      buyer_tax_id: body.buyer_tax_id ?? null,
      buyer_tax_id_type: body.buyer_tax_id_type ?? null,
      partner_note: body.partner_note ?? null,
      lines: lines as any,
      destination_country_code: body.destination_country_code,
      destination_postal_code: body.destination_postal_code ?? null,
      destination_city: body.destination_city ?? null,
      currency_code: body.currency_code,
      region_id: body.region_id ?? null,
      carrier: body.carrier,
      duties_prepaid: body.duties_prepaid ?? false,
      // The number behind the promise (#1447). The validator has already
      // refused one without the other, so these two travel together or not at all.
      duty_total: body.duty_total ?? null,
      duty_basis: body.duty_basis ?? null,
      // The rate form is the normal one; the AMOUNTS are computed by the view
      // against the basket it actually priced, never taken from the client.
      duty_rate_percent: body.duty_rate_percent ?? null,
      import_tax_rate_percent: body.import_tax_rate_percent ?? null,
      import_tax_total: body.import_tax_total ?? null,
      ddp_fee_total: body.ddp_fee_total ?? null,
      // #1439 S12 — freight the partner named, and why. Replaces the
      // picked option's amount; the lane and the consignment weight are
      // still computed, because they are what make the number checkable.
      freight_override_amount: body.freight_override_amount ?? null,
      freight_basis: body.freight_basis ?? null,
      ttl_days: body.ttl_days,
      // The agreed deposit share (#1439 S11). `?? null` and never `?? 30`:
      // the fallback chain lives in one place (`resolveDepositPct`), and a
      // default applied here would freeze 30 onto the quote as though the
      // partner had chosen it.
      deposit_pct: body.deposit_pct ?? null,
      created_by: req.auth_context?.actor_id ?? null,
    },
  })

  // Best-effort: activity logging must never turn a successful mint into a 500.
  // A lost log line is recoverable; a failed mint that already created a live
  // price list is not.
  const quoteService: any = req.scope.resolve(PARTNER_QUOTE_MODULE)
  await quoteService
    .recordEvent({
      quote_id: (result as any)?.quote?.id,
      type: "minted",
      actor_type: "partner",
      actor_id: partner.id,
      message: `Quote minted with ${body.lines.length} line(s).`,
      data: { line_count: body.lines.length, ttl_days: body.ttl_days ?? null },
    })
    .catch(() => {})

  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  logger.info(
    `[quote] partner=${partner.id} minted quote=${(result as any)?.quote?.id} lines=${body.lines.length}`
  )

  // #1420 — send the link rather than making the partner copy it out. Awaited,
  // not queued: the response has to be able to say whether it went, because if
  // it did not, the token in this body is the only copy left.
  const email = await deliverQuoteEmail(req.scope, {
    quote: (result as any)?.quote,
    token: (result as any)?.token,
    partnerName: partner?.name ?? null,
    lineCount: body.lines.length,
    actorType: "partner",
    actorId: partner.id,
  })

  res.status(201).json({
    quote: (result as any)?.quote,
    /** Once. Never retrievable again. */
    token: (result as any)?.token,
    /**
     * Composed server-side (#1420). Both UIs used to assemble this themselves
     * and disagreed; the admin one read fields the quote does not have and so
     * never produced a link at all.
     */
    buyer_url: email.buyer_url,
    /** Whether the buyer actually has it. `sent: false` is a call to action. */
    email,
  })
}
