import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { listPayableRuns } from "../../../../workflows/payment_submissions/lib/payable-runs"

/**
 * GET /admin/payment-submissions/payable-runs?partner_id=…
 *
 * The completed production runs a partner can be paid for, one row per RUN.
 *
 * ## Why this exists
 *
 * The admin submission screen listed DESIGNS. A design is not a payable thing —
 * it is a recipe, produced many times, and the money lives on the run: the rate
 * a partner agreed to (`partner_cost_estimate` + `cost_type`) and how many
 * finished pieces they actually made (`produced_quantity`). Listing designs
 * meant the screen had no quantity to show and no rate to show, so it billed
 * `design.estimated_cost` — a PER-UNIT figure — exactly once. That is #1554,
 * and it was ₹850 for nine garments.
 *
 * Pricing from the design is not a near-miss either: for Bakshi's Design the
 * design's own cost would have billed 11,530.80 where the run says 7,650, and
 * Denim Trouser has no design cost at all and would have billed 0.
 *
 * ## The quantity this bills
 *
 * 🔑 `payable_quantity` is the PRODUCED quantity, not the ordered one — the
 * founder rule is that a partner is paid for what they made. `runPayableAmount`
 * (the auto-draft path) still multiplies by `run.quantity`, which is why a run
 * ordered 9 and produced 4 drafts 9 units' worth unless a caller says
 * otherwise. This endpoint is that caller: it states produced and ordered
 * side by side so the screen shows which one it is billing and the reviewer can
 * see the two disagree.
 *
 * Runs with no produced figure fall back to ordered and are flagged
 * `produced_quantity: null`, so "we never recorded output" is visibly distinct
 * from "they made zero".
 *
 * ## What "already paid for" means
 *
 * A run is billed when a payment line records it in `production_run_ids` and
 * that submission is not Rejected. This is a stronger guard than the existing
 * "is this design in an OPEN submission" check, which stops being true the
 * moment a submission is Approved or Paid — after which the same finished run
 * could be claimed again and the second claim would look exactly as legitimate
 * as the first.
 *
 * ## "Not billed" and "we can't tell" are different answers
 *
 * 🔴 Every payment line in production recorded no run at all, so this guard was
 * inert on real data while the screen showed its output as fact: 13 of 13
 * submissions returned `billed: null`, which the sort then ranked as clean,
 * payable work. Absence read as permission — #1557's shape, on the field that
 * decides whether someone is paid twice.
 *
 * So a run now reports `billing_status`, not just `billed`:
 *
 *   - `clear`   — every live payout for this design names the runs it covered,
 *                 and this is not one of them.
 *   - `unknown` — a live payout for this design is `run_provenance:
 *                 "not_recorded"`: it pays for run work and never said which
 *                 run. This run may already be inside it. A human has to
 *                 establish what that payout covered before any money moves.
 *   - `billed`  — a line names this run.
 *
 * A task payout (`run_provenance: "no_run"`) is not a source of doubt: there
 * was never a run behind it. That distinction is the whole reason provenance is
 * a stated column rather than something re-derived from a NULL. See
 * `payment_submission_item.run_provenance` and #1565.
 *
 * ⚠️ `design_has_open_submission` remains reported alongside, but it is the
 * older, weaker signal — it goes false the moment a submission is Approved.
 * Branch on `billing_status`.
 *
 * 🔑 The answer lives in `workflows/payment_submissions/lib/payable-runs`, so
 * "Who to pay" (#2480) sums exactly what this screen offers.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const partnerId = String(
    (req.validatedQuery as any)?.partner_id ?? (req.query as any)?.partner_id ?? ""
  ).trim()

  if (!partnerId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "partner_id is required"
    )
  }

  return res.status(200).json(await listPayableRuns(req.scope, partnerId))
}
