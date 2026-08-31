import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import { PARTNER_QUOTE_MODULE } from "../../../modules/partner-quote"
import { buildQuoteListQuery } from "../../../modules/partner-quote/lib/list-query"
import { withEffectiveStatus } from "../../../modules/partner-quote/lib/token"
import { totalQuotedQuantity } from "../../../modules/partner-quote/lib/quote-email"
import { resolveQuoteDesignLines } from "../../../modules/partner-quote/lib/design-lines"
import { deliverQuoteEmail } from "../../../workflows/partner-quote/deliver-quote-email"
import { mintQuoteWorkflow } from "../../../workflows/partner-quote/mint-quote"
import { assertVariantsInStore } from "./lib/assert-variants-in-store"
import {
  ensureDesignProductsInCatalogue,
  makeDesignVariantPort,
} from "../../../workflows/partner-quote/ensure-design-quote-variant"

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

/**
 * List across partners, or scoped to one.
 *
 * 🔑 `count` is the number of MATCHING rows, not the length of this page.
 * It used to be `quotes.length` over an unpaginated read, which made the
 * admin table's pager a client-side illusion over the whole table and its
 * count meaningless. Paging, search and sort semantics are shared with
 * `/partners/quotes` via `buildQuoteListQuery` so the two surfaces cannot
 * drift.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(PARTNER_QUOTE_MODULE)

  // 🔑 ONE `now` for the filter and the stamp (#1510), so a row cannot be
  // selected as active and then labelled expired in the same response.
  const now = new Date()
  const { filters, config } = buildQuoteListQuery(req.query as any, {}, now)

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
    fields: [
      "id",
      "name",
      "stores.id",
      "stores.default_location_id",
      "stores.default_sales_channel_id",
    ],
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

  /**
   * #1486 — resolve design lines to variants BEFORE the catalogue assertion
   * below, which reads `variant_id` off every line and would otherwise assert
   * `undefined` into a pass.
   *
   * 🔑 Unscoped by partner, unlike the partner surface: an admin legitimately
   * quotes a design the producing partner does not own. The guard that matters
   * on this route is the next one — the resolved variant still has to be in
   * that partner's sales channel.
   */
  const lines = await resolveQuoteDesignLines(req.scope, {
    lines: body.lines,
    partner_id: null,
    /**
     * A design with no product behind it is minted a made-to-order variant
     * here rather than refused. The currency is the quote's, because that is
     * what the variant has to be listed in — the estimate behind it is
     * denominated in the design's own cost currency and converted on the way
     * through.
     */
    variant_port: makeDesignVariantPort(req.scope, {
      currency_code: body.currency_code,
      partner_id: null,
      // Unscoped for VISIBILITY, catalogued for THIS partner. Two questions,
      // two inputs — see `catalogue_sales_channel_id`.
      catalogue_sales_channel_id: store.default_sales_channel_id,
    }),
  })

  /**
   * A design already carrying a made-to-order product is not re-minted — the
   * port returns straight away — so the channel it was born in is the one it
   * keeps unless something adds this partner's. That is what this does, for
   * the designs the mint above did not create.
   *
   * Before the assertion below, deliberately: the assertion is the gate, and
   * this is the last chance to make it true. It adds only to custom-design
   * products; anything else still gets refused, which is right.
   */
  await ensureDesignProductsInCatalogue(req.scope, {
    lines: lines as any,
    sales_channel_id: store.default_sales_channel_id,
  })

  // 🔴 An admin picks the partner from one dropdown and the variants from
  // another; a single mis-click freezes one partner's prices onto another
  // partner's customer group, and NOTHING downstream catches it. The partner
  // surface cannot make this mistake, so the guard lives here.
  await assertVariantsInStore(req.scope, {
    variantIds: (lines ?? []).map((l: any) => l.variant_id),
    salesChannelId: store.default_sales_channel_id,
    partnerLabel: partner.name || partnerId,
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

  // #1420 — the same send as the partner route, from the same function. An
  // admin mint is where this matters most: the admin panel composed the buyer
  // link from `quote.storefront_domain`, a field the quote does not have, so
  // an admin has never been able to copy a working link at all.
  const email = await deliverQuoteEmail(req.scope, {
    quote: (result as any)?.quote,
    token: (result as any)?.token,
    partnerName: partner?.name ?? null,
    lineCount: body.lines.length,
    totalQuantity: totalQuotedQuantity(body.lines),
    actorType: "admin",
    actorId: (req as any).auth_context?.actor_id ?? null,
  })

  res.status(201).json({
    quote: (result as any)?.quote,
    /** Once. Never retrievable again. */
    token: (result as any)?.token,
    /** Composed server-side (#1420) — see the partner route. */
    buyer_url: email.buyer_url,
    /** Whether the buyer actually has it. `sent: false` is a call to action. */
    email,
  })
}
