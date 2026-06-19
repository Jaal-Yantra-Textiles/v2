/**
 * @file Partner-side API route for a partner's transaction-fee (commission) ledger.
 * @description Self-serve read-only mirror of `GET /admin/partners/[id]/fees`
 * (#336 Slice 4). Identical wire contract; the only difference is auth scoping —
 * a partner may only read its own fees.
 * @module API/Partners/Fees
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../../helpers"
import { PARTNER_BILLING_MODULE } from "../../../../modules/partner_billing"
import { summarizePartnerFees } from "../../../../modules/partner_billing/lib/summarize-fees"

/**
 * GET /partners/[id]/fees
 *
 * Lists the authenticated partner's accrued commission fees + roll-up summary.
 * Read-only. Forbidden if the auth context's partner does not match `:id`.
 */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { id: partnerId } = req.params

  // AuthZ: the caller must be the partner they're reading.
  const actorId = req.auth_context?.actor_id
  if (!actorId) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Unauthorized")
  }
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner || partner.id !== partnerId) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Forbidden: partner mismatch"
    )
  }

  const offset = Number(req.query.offset ?? 0) || 0
  const limit = Number(req.query.limit ?? 50) || 50
  const status = typeof req.query.status === "string" ? req.query.status : undefined

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const billing: any = req.scope.resolve(PARTNER_BILLING_MODULE)

  const filters: Record<string, unknown> = { partner_id: partnerId }
  if (status) {
    filters.status = status
  }

  const all = (await billing.listPartnerFees(filters)) || []
  const summary = summarizePartnerFees(all)
  const fees = all.slice(offset, offset + limit)

  return res.status(200).json({
    partner_id: partnerId,
    fees,
    count: all.length,
    offset,
    limit,
    summary,
  })
}
