import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import type { Link } from "@medusajs/modules-sdk"

import PartnerCreditLink from "../../../../../links/partner-credit-link"
import InventoryOrderPartnerCreditLink from "../../../../../links/inventory-order-partner-credit"
import { INTERNAL_PAYMENTS_MODULE } from "../../../../../modules/internal_payments"
import type InternalPaymentService from "../../../../../modules/internal_payments/service"
import { foldPartnerCredits } from "../../../../../modules/internal_payments/lib/fold-credits"

/**
 * GET/POST /admin/partners/:id/credits — money a partner already holds (#1712).
 *
 * 🔴 Why this route exists at all: `foldPartnerLedger` clamps `settled_amount`
 * to each payout's own value, so an overpayment is invisible on every screen.
 * hrhandloom was paid 30,000 against a payout worth 28,620 and the ledger reads
 * `paid: 28,670`, `recorded: 0`. The surplus existed only in a chat transcript.
 *
 * ⚠️ Reads are scoped BY partner through the link, never by a column — there is
 * no partner column on `partner_credit`, the same reason payments needed
 * `partner-payments-link`.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const partnerId = String(req.params.id)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any

  const { data } = await query.graph({
    entity: PartnerCreditLink.entryPoint,
    fields: ["partner_credit.*"],
    filters: { partner_id: partnerId },
  })

  const credits = (data || [])
    .map((row: any) => row?.partner_credit)
    .filter(Boolean)

  /**
   * `open_total` is what a reader actually needs — "how much does this partner
   * already hold that no payout has consumed". Reported, never netted against
   * `outstanding`: applying a credit is a deliberate act (see the model).
   *
   * Folded by the SHARED helper, which the partner route also uses. Two
   * surfaces folding one money figure for themselves is how they start
   * disagreeing.
   */
  return res.json({ credits, ...foldPartnerCredits(credits) })
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const partnerId = String(req.params.id)
  const body = (req.validatedBody ?? req.body ?? {}) as any

  const amount = Number(body.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "amount must be a positive number"
    )
  }

  /**
   * 🔑 `reason` is REQUIRED and deliberately not defaulted. A bare amount with
   * no statement of origin is the shape that let `metadata` blobs decide
   * payouts (#1557); the next reader must be able to audit this without the
   * conversation that produced it.
   */
  const reason = String(body.reason ?? "").trim()
  if (!reason) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "reason is required — a credit with no stated origin cannot be audited"
    )
  }

  const service: InternalPaymentService = req.scope.resolve(
    INTERNAL_PAYMENTS_MODULE
  )

  const credit = await (service as any).createPartnerCredits({
    amount,
    currency_code: String(body.currency_code ?? "inr"),
    source_type: body.source_type ?? "overpayment",
    reason,
    source_submission_id: body.source_submission_id ?? null,
    metadata: body.metadata ?? null,
  })

  const created = Array.isArray(credit) ? credit[0] : credit

  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK) as Link
  await remoteLink.create({
    ["partner"]: { partner_id: partnerId },
    [INTERNAL_PAYMENTS_MODULE]: { partner_credit_id: created.id },
  } as any)

  /**
   * The order this credit is earmarked against, when one is named. Optional by
   * design — a credit can be partner-wide, and inventing an order would be
   * inventing a decision.
   */
  if (body.inventory_order_id) {
    await remoteLink.create({
      ["inventory_orders"]: {
        inventory_orders_id: String(body.inventory_order_id),
      },
      [INTERNAL_PAYMENTS_MODULE]: { partner_credit_id: created.id },
    } as any)
  }

  return res.status(201).json({ credit: created })
}
