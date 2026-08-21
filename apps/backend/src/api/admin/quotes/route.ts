import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import { PARTNER_QUOTE_MODULE } from "../../../modules/partner-quote"
import { mintQuoteWorkflow } from "../../../workflows/partner-quote/mint-quote"

/**
 * Admin quotes (#1389 S5).
 *
 * The same capability the partner has, reached differently: an admin has no
 * partner of their own, so `partner_id` is required to MINT and optional to
 * LIST. That is the whole difference between the two surfaces.
 *
 * 🔑 Minting goes through `mintQuoteWorkflow` — the same workflow the partner
 * route uses. A second inline implementation would drift from the one that
 * freezes prices, creates the customer group, asserts the price-list rule from
 * a re-read and deletes the list if that assertion fails. That assertion is the
 * only thing standing between a quote and a platform-wide price cut.
 */

/** List across partners, or scoped to one. */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(PARTNER_QUOTE_MODULE)

  const partnerId = String((req.query.partner_id as string) || "").trim()
  const status = String((req.query.status as string) || "").trim()

  const filters: Record<string, unknown> = {}
  if (partnerId) filters.partner_id = partnerId
  if (status) filters.status = status

  const quotes = await service.listPartnerQuotes(filters)

  res.json({ quotes, count: quotes?.length ?? 0 })
}

/**
 * Mint on a partner's behalf.
 *
 * 🔴 The raw token is returned HERE and nowhere else — only its sha256 is
 * persisted. An admin list can therefore never show a working link for an
 * existing quote, and must not pretend to: the only way to get a fresh link is
 * to mint again.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = req.validatedBody as any
  const partnerId = String(body.partner_id || "").trim()

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: partners } = await query.graph({
    entity: "partners",
    fields: ["id", "name", "stores.id", "stores.default_location_id"],
    filters: { id: partnerId },
  })

  const partner = partners?.[0] as any
  if (!partner) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Partner not found")
  }

  const store = partner.stores?.[0]
  if (!store?.id) {
    // A quote is priced against a store's catalogue and shipped from its
    // location. Without one there is nothing to quote, and failing here is far
    // cheaper than minting a quote that prices nothing.
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Partner ${partner.name || partnerId} has no store, so a quote cannot be priced for them.`
    )
  }

  const { result } = await mintQuoteWorkflow(req.scope).run({
    input: {
      partner_id: partner.id,
      store: { id: store.id, default_location_id: store.default_location_id },
      buyer_email: body.buyer_email,
      recipient_name: body.recipient_name ?? null,
      recipient_company: body.recipient_company ?? null,
      partner_note: body.partner_note ?? null,
      lines: body.lines,
      destination_country_code: body.destination_country_code,
      destination_postal_code: body.destination_postal_code ?? null,
      destination_city: body.destination_city ?? null,
      currency_code: body.currency_code,
      region_id: body.region_id ?? null,
      carrier: body.carrier,
      ttl_days: body.ttl_days,
      // Stamped with the ADMIN's actor id, not the partner's — otherwise an
      // admin-minted quote is indistinguishable from one the partner made
      // themselves, and "who quoted this price" is exactly the question asked
      // when a buyer disputes it.
      created_by: (req as any).auth_context?.actor_id ?? null,
    },
  })

  const service: any = req.scope.resolve(PARTNER_QUOTE_MODULE)
  await service
    .recordEvent({
      quote_id: (result as any)?.quote?.id,
      type: "minted",
      // 🔑 `admin`, not `partner`. An admin-minted quote must never look like
      // one the partner made themselves — that is the first question asked when
      // a buyer challenges a price.
      actor_type: "admin",
      actor_id: (req as any).auth_context?.actor_id ?? null,
      message: `Minted by an admin on behalf of ${partner.name || partner.id}.`,
      data: { line_count: body.lines.length, partner_id: partner.id },
    })
    .catch(() => {})

  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  logger.info(
    `[quote] admin minted quote=${(result as any)?.quote?.id} for partner=${partner.id} lines=${body.lines.length}`
  )

  res.status(201).json({
    quote: (result as any)?.quote,
    /** Once. Never retrievable again. */
    token: (result as any)?.token,
  })
}
