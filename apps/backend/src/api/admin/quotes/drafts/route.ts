import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import { PARTNER_QUOTE_MODULE } from "../../../../modules/partner-quote"

/**
 * Draft quotes (#1446) — the draft-order rail, mirrored.
 *
 * A draft is a REAL ROW from the first save, exactly as a draft order is. The
 * create modal asks only for what the table's NOT NULL columns demand —
 * partner, where it ships, and the currency the region supplies — and the
 * items, freight and duty terms are edited on the draft afterwards.
 *
 * 🔴 A draft has NO `token_hash`, and that is what keeps it away from buyers.
 * `findByTokenHash` matches on that column and NULL equals nothing, so no token
 * can ever resolve to a draft. It is unpriced by definition; showing one to a
 * buyer would be showing a price that does not exist yet.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = req.validatedBody as any
  const partnerId = String(body.partner_id || "").trim()

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: partners } = await query.graph({
    entity: "partners",
    fields: ["id", "name", "stores.id"],
    filters: { id: partnerId },
  })

  const partner = partners?.[0] as any
  if (!partner) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Partner not found")
  }

  /**
   * The same refusal the mint makes, made HERE instead of three sections later.
   *
   * A quote is priced against a store's catalogue and shipped from its
   * location. Letting a draft be created for a partner with no store would let
   * an operator fill in a basket, a destination and duty terms before being
   * told none of it can ever be priced.
   */
  if (!partner.stores?.[0]?.id) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Partner ${partner.name || partnerId} has no store, so a quote cannot be priced for them.`
    )
  }

  const service: any = req.scope.resolve(PARTNER_QUOTE_MODULE)

  const quote = await service.createPartnerQuotes({
    partner_id: partnerId,
    store_id: partner.stores[0].id,
    status: "draft",
    // Never invented: the buyer's credential is minted once, at mint, and is
    // unrecoverable afterwards. See the model's `token_hash`.
    token_hash: null,
    destination_country_code: body.destination_country_code,
    currency_code: body.currency_code,
    region_id: body.region_id ?? null,
    destination_postal_code: body.destination_postal_code ?? null,
    destination_city: body.destination_city ?? null,
    email_sent_to: body.buyer_email ?? null,
    recipient_name: body.recipient_name ?? null,
    recipient_company: body.recipient_company ?? null,
    buyer_tax_id: body.buyer_tax_id ?? null,
    buyer_tax_id_type: body.buyer_tax_id_type ?? null,
    partner_note: body.partner_note ?? null,
    // 🔑 `??`, never `||` — a 0% deposit is a real term and `||` would store it
    // as "unset", which resolves to the 30% platform default.
    deposit_pct: body.deposit_pct ?? null,
    created_by: (req as any).auth_context?.actor_id ?? null,
  })

  res.status(201).json({ draft: quote })
}
