import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { PARTNER_QUOTE_MODULE } from "../../../../../../modules/partner-quote"
import { POST as mintQuote } from "../../../route"

/**
 * Freeze a draft into a real quote (#1446).
 *
 * ## It calls the mint route's own handler, deliberately
 *
 * `POST /admin/quotes` resolves design lines to variants, mints made-to-order
 * products into the partner's catalogue, asserts every variant really is in
 * that partner's store, runs `mintQuoteWorkflow` and delivers the buyer's
 * email. Its own docblock says why a second implementation must not exist:
 * that workflow's price-list assertion "is the only thing standing between a
 * quote and a platform-wide price cut."
 *
 * So this does not restate any of it. It reads the draft's stored answers,
 * shapes them into the body that route already validates, and hands them to the
 * SAME function — which reads nothing from the request but `scope` and
 * `validatedBody`. One mint, reached two ways.
 *
 * ## The draft is consumed, not converted
 *
 * A minted quote is a new row: the workflow creates it, complete with the token
 * hash a draft has never had. The draft is deleted once that has succeeded —
 * after, never before, so a mint that throws leaves the operator's work exactly
 * where they left it rather than destroying it on the way to an error.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(PARTNER_QUOTE_MODULE)
  const id = String(req.params.id || "")

  const draft = id ? await service.retrievePartnerQuote(id).catch(() => null) : null
  if (!draft) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Draft not found")
  }
  if (draft.status !== "draft") {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `Quote ${id} is ${draft.status}, not a draft — it has already been minted.`
    )
  }

  const lines = await service.listPartnerQuoteLines({ quote_id: draft.id })
  if (!lines?.length) {
    /**
     * Refused here rather than deep inside the pricer, where the same
     * condition surfaces as an arithmetic error about an empty basket.
     */
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "This draft has no items, so there is nothing to price."
    )
  }

  const body = {
    partner_id: draft.partner_id,
    buyer_email: draft.email_sent_to,
    recipient_name: draft.recipient_name,
    recipient_company: draft.recipient_company,
    buyer_tax_id: draft.buyer_tax_id,
    buyer_tax_id_type: draft.buyer_tax_id_type,
    partner_note: draft.partner_note,
    currency_code: draft.currency_code,
    region_id: draft.region_id,
    destination_country_code: draft.destination_country_code,
    destination_postal_code: draft.destination_postal_code,
    destination_city: draft.destination_city,
    // 🔑 `??`, never `||`: a stored 0% deposit is a real term.
    deposit_pct: draft.deposit_pct ?? null,
    duties_prepaid: draft.duties_prepaid ?? false,
    ...(draft.duties_prepaid
      ? {
          duty_rate_percent: draft.duty_rate_percent ?? null,
          import_tax_rate_percent: draft.import_tax_rate_percent ?? null,
          ddp_fee_total: draft.ddp_fee_total ?? null,
          duty_basis: draft.duty_basis || null,
        }
      : {}),
    lines: [...lines]
      .sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0))
      .map((l: any) => ({
        variant_id: l.variant_id,
        quantity: l.quantity,
        position: l.position ?? 0,
        ...(l.design_id ? { design_id: l.design_id } : {}),
      })),
  }

  /**
   * The response is written by the mint handler itself, so the body an operator
   * receives here — the raw token included — is byte-for-byte the one the
   * ordinary mint returns. A hand-rolled echo would be a second contract to
   * keep in step.
   */
  const captured: { status?: number; body?: unknown } = {}
  const proxyRes = {
    status(code: number) {
      captured.status = code
      return this
    },
    json(payload: unknown) {
      captured.body = payload
      return this
    },
  } as unknown as MedusaResponse

  await mintQuote(
    { scope: req.scope, validatedBody: body } as unknown as MedusaRequest,
    proxyRes
  )

  // Only now. A throw above leaves the draft intact.
  // Lines first — see the DELETE handler: a parent delete with children still
  // pointing at it fails with a message that names the parent as missing.
  await service.deletePartnerQuoteLines(lines.map((l: any) => l.id))
  await service.deletePartnerQuotes([draft.id])

  res
    .status(captured.status ?? 201)
    .json({ ...(captured.body as object), draft_id: draft.id })
}
