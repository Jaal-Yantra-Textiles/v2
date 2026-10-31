import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { listPayableInventoryOrders } from "../../../../workflows/payment_submissions/lib/payable-inventory-orders"
import { listPayableRuns } from "../../../../workflows/payment_submissions/lib/payable-runs"
import { readPartnerLedger } from "../../payments/partners/[id]/ledger/read-ledger"
import {
  comparePartnersOwed,
  partnerNeedsAttention,
  summarizePartnerOwed,
  type PartnerOwedRow,
} from "./summarize"

/**
 * GET /admin/payment-submissions/partners-owed
 *
 * "Who to pay" (#2480): one row per partner we owe money to, most owed first.
 *
 * ## Why this exists
 *
 * No screen said who is owed. The payouts list shows payouts already RAISED,
 * newest first, and the create screen answers "what can I pay THIS partner
 * for" only once someone has already picked the partner. Raja Shawls' ₹4,400
 * waited because nothing put their name in front of anyone.
 *
 * ## Where the numbers come from
 *
 * 🔑 The SAME three answers the payout screens give, per partner — never a
 * re-derivation. `listPayableRuns` (the create screen's runs tab),
 * `listPayableInventoryOrders` (its goods tab) and `readPartnerLedger` (the
 * partner page's ledger). `summarizePartnerOwed` only adds them up; see it for
 * what is deliberately left OUT of the total.
 *
 * ## Cost
 *
 * ⚠️ It is every partner's payout screens at once — roughly a dozen reads per
 * partner. Partners are walked a few at a time so the request cannot take
 * every database connection (local Aiven has 20). A partner whose read fails
 * is reported as a failure row, not dropped: a partner missing from "who to
 * pay" reads as "owed nothing", which is the reading that leaves someone
 * unpaid.
 *
 * Query: `include_settled=true` also returns partners owed nothing.
 */
const CONCURRENCY = 3

type FailedRow = { partner_id: string; partner_name: string | null; error: string }

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const includeSettled =
    String(
      (req.validatedQuery as any)?.include_settled ??
        (req.query as any)?.include_settled ??
        ""
    ).toLowerCase() === "true"

  const query: any = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: partners } = await query.graph({
    entity: "partner",
    fields: ["id", "name", "handle", "status"],
  })

  const all = ((partners || []) as any[]).filter((p) => p?.id)
  const rows: PartnerOwedRow[] = []
  const failed: FailedRow[] = []

  for (let i = 0; i < all.length; i += CONCURRENCY) {
    const batch = all.slice(i, i + CONCURRENCY)
    await Promise.all(
      batch.map(async (partner) => {
        const id = String(partner.id)
        try {
          const [runs, inventoryOrders, ledger] = await Promise.all([
            listPayableRuns(req.scope, id),
            listPayableInventoryOrders(req.scope, id),
            readPartnerLedger(req.scope, id),
          ])
          rows.push(
            summarizePartnerOwed({ partner, runs, inventoryOrders, ledger })
          )
        } catch (e: any) {
          failed.push({
            partner_id: id,
            partner_name: partner.name ?? null,
            error: String(e?.message || e),
          })
        }
      })
    )
  }

  const shown = (includeSettled ? rows : rows.filter(partnerNeedsAttention)).sort(
    comparePartnersOwed
  )

  const total_owed =
    Math.round(shown.reduce((acc, r) => acc + r.total_owed, 0) * 100) / 100

  return res.status(200).json({
    partners_owed: shown,
    count: shown.length,
    total_owed,
    /** Partners checked and owed nothing, when they are not listed. */
    settled_count: rows.length - shown.length,
    /** Partners whose numbers could not be read. Never read as "owed nothing". */
    failed,
    failed_count: failed.length,
  })
}
