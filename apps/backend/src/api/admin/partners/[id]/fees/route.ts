/**
 * @file Admin API route for a partner's transaction-fee (commission) ledger.
 * @description Read-only listing + roll-up of the platform commission accrued
 * per order for a partner (#336 Slice 4). Mirrors the money-rollup envelope of
 * `/admin/payment_reports/by-partner`, scoped to one partner.
 * @module API/Admin/Partners/Fees
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { PARTNER_BILLING_MODULE } from "../../../../../modules/partner_billing"
import { summarizePartnerFees } from "../../../../../modules/partner_billing/summarize-fees"

/**
 * GET /admin/partners/[id]/fees
 *
 * Lists the `partner_fee` rows accrued for a partner plus a roll-up summary
 * (totals, by-status, by-currency). Read-only — fees are accrued/reversed by the
 * order.placed / order.canceled subscribers, never mutated here.
 *
 * Query: `status` (filter to one fee status), `offset`/`limit` (pagination).
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const partnerId = req.params.id

  const offset = Number(req.query.offset ?? 0) || 0
  const limit = Number(req.query.limit ?? 50) || 50
  const status = typeof req.query.status === "string" ? req.query.status : undefined

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const billing: any = req.scope.resolve(PARTNER_BILLING_MODULE)

  const filters: Record<string, unknown> = { partner_id: partnerId }
  if (status) {
    filters.status = status
  }

  // Roll-up is over the full filtered set (not the paginated page), so summary
  // totals stay correct regardless of offset/limit (the page-vs-set bug, #484).
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
