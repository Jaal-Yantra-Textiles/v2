import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { PARTNER_QUOTE_MODULE } from "../../../../../modules/partner-quote"

/**
 * One draft: read it, save a section's answers into it, or throw it away.
 */

/**
 * 🔴 Every handler here re-reads the row and refuses anything that is not a
 * draft.
 *
 * The id comes from the URL, and a URL naming a MINTED quote would otherwise
 * let this route rewrite a frozen price — the one thing a quote exists to make
 * unrewritable. Checking the status on the row we just read, rather than
 * trusting the caller to only send draft ids, is the difference between a
 * guard and a convention.
 */
const loadDraft = async (req: MedusaRequest) => {
  const service: any = req.scope.resolve(PARTNER_QUOTE_MODULE)
  const id = String(req.params.id || "")

  if (!id) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Draft not found")
  }

  const quote = await service.retrievePartnerQuote(id).catch(() => null)
  if (!quote) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Draft not found")
  }

  if (quote.status !== "draft") {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `Quote ${id} is ${quote.status}, not a draft. A minted quote's prices are frozen and cannot be edited here — use /admin/quotes/:id/adjust.`
    )
  }

  return { service, quote }
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { service, quote } = await loadDraft(req)
  const lines = await service.listPartnerQuoteLines({ quote_id: quote.id })
  res.json({ draft: { ...quote, lines } })
}

/**
 * A section saves its own answers.
 *
 * Only the keys a section actually sent are written. The buyer section must be
 * able to save a company name without restating the destination, and spreading
 * a partial body over the row would write `undefined` across every field it
 * omitted.
 */
export const PATCH = async (req: MedusaRequest, res: MedusaResponse) => {
  const { service, quote } = await loadDraft(req)
  const body = req.validatedBody as any

  const FIELDS = [
    "region_id",
    "currency_code",
    "destination_country_code",
    "destination_postal_code",
    "destination_city",
    "recipient_name",
    "recipient_company",
    "buyer_tax_id",
    "buyer_tax_id_type",
    "partner_note",
    "deposit_pct",
    "duties_prepaid",
    "duty_rate_percent",
    "import_tax_rate_percent",
    "ddp_fee_total",
    "duty_basis",
    "quoted_shipping_option_id",
  ] as const

  const patch: Record<string, unknown> = {}
  for (const key of FIELDS) {
    // `in`, not truthiness: `null` clears a field and `0` is a real deposit.
    if (key in body) patch[key] = body[key]
  }
  if ("buyer_email" in body) patch.email_sent_to = body.buyer_email

  if (Object.keys(patch).length) {
    await service.updatePartnerQuotes({ id: quote.id, ...patch })
  }

  /**
   * The basket is replaced wholesale when the items section sends one.
   *
   * 🔑 Absent `lines` means "this section did not speak", NOT "empty the
   * basket" — which is why this is guarded on presence rather than on length.
   * A buyer section saving a company name would otherwise silently delete
   * every item.
   */
  if (Array.isArray(body.lines)) {
    const existing = await service.listPartnerQuoteLines({ quote_id: quote.id })
    if (existing?.length) {
      await service.deletePartnerQuoteLines(existing.map((l: any) => l.id))
    }
    if (body.lines.length) {
      await service.createPartnerQuoteLines(
        body.lines.map((l: any, index: number) => ({
          quote_id: quote.id,
          variant_id: l.variant_id,
          product_id: l.product_id ?? null,
          design_id: l.design_id ?? null,
          quantity: l.quantity,
          position: l.position ?? index,
        }))
      )
    }
  }

  const fresh = await service.retrievePartnerQuote(quote.id)
  const lines = await service.listPartnerQuoteLines({ quote_id: quote.id })
  res.json({ draft: { ...fresh, lines } })
}

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const { service, quote } = await loadDraft(req)

  /**
   * 🔴 The basket goes FIRST, or the parent delete fails.
   *
   * `PartnerQuoteLine` belongs to the quote, and deleting the parent while its
   * lines still point at it answers
   * "You tried to set relationship id: <the quote's id>, but such entity does
   * not exist" — a 400 that names the row being deleted, so it reads as "this
   * draft is missing" when it actually means "this draft still has children".
   * A draft with an empty basket deleted fine, which is exactly why this only
   * showed up once a real basket had been saved.
   */
  const lines = await service.listPartnerQuoteLines({ quote_id: quote.id })
  if (lines?.length) {
    await service.deletePartnerQuoteLines(lines.map((l: any) => l.id))
  }
  /**
     * 🔴 An ARRAY, always. Given a bare string the generated delete reads it as
     * a relationship selector and answers
     * "You tried to set relationship id: …, but such entity does not exist" —
     * a 400 that names the row it just refused to delete, so it reads like the
     * row is missing rather than like the call is malformed. Same family as
     * `updateStores({ id, ... })` being a selector rather than an update.
     */
    await service.deletePartnerQuotes([quote.id])
  res.json({ id: quote.id, object: "quote_draft", deleted: true })
}
