/**
 * @route GET /admin/payments/partners/:id/ledger
 * @scope admin
 *
 * Everything this partner has been paid or is owed, from BOTH records (#1612).
 *
 * 🔴 There are two, and no surface showed both. Since #1638 a payout is a
 * payment SUBMISSION and approval writes no `internal_payments` row at all,
 * while the 31 rows written before that exist only as `internal_payments`. The
 * partner page rendered a panel per record, so the one labelled "Payments"
 * quietly turned into a history list that a reader had no way to know was
 * partial — the #1621 shape.
 *
 * 🔴 CORRECTED (#1710) — this route used to say the two could only be joined
 * through the RECONCILIATION, because `defineLink(paymentSubmission,
 * internalPayments)` generates a 73-character table name and "the table was
 * never created, in either environment, with no error raised". That is wrong.
 * Medusa abbreviates each segment of an over-long link name to four characters
 * and appends a hash, and the table exists and is migrated in both:
 *
 *     paym_subm_paym_subm_inte_paym_inte_paym-9812b09f
 *
 * `query.graph` returned no `payments` key because the table held ZERO ROWS.
 * Nothing wrote it — a capability declared dead on a mechanism that was never
 * the mechanism. `linkPaymentToSubmissionsStep` writes it now.
 *
 * ## Where a partner's payments are read from (#1710)
 *
 * THREE homes, unioned and deduped by payment id — because one payment may sit
 * in any of them and a reader that knows only one reports the others as zero:
 *
 *   1. the PARTNER link          — how a payment recorded on the partner arrives
 *   2. the INVENTORY ORDER link  — how `POST /partners/inventory-orders/:id/
 *                                  submit-payment` records one. Two Completed
 *                                  INR 10,000 payments lived only here, so the
 *                                  ledger said `recorded: 0` while the order
 *                                  page said `recorded: 20000`.
 *   3. the SUBMISSION link       — a payment that names the payout it settles.
 *
 * ⚠️ Reading by order needs no backfill, which is why it is a read-side union
 * rather than a data migration: every historical row is covered the moment this
 * ships, and nothing has to be rewritten to be seen.
 *
 * Response: { entries, totals, count }
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { readPartnerLedger } from "./read-ledger"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id: partner_id } = req.params

  return res.status(200).json(await readPartnerLedger(req.scope, partner_id))
}
