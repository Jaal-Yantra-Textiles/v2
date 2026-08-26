import { model } from "@medusajs/framework/utils"
import PaymentSubmission from "./payment_submission"

/**
 * A line item on a partner payment submission.
 *
 * An item is tied to either a design (the original behaviour) or a task
 * (partners can also submit individual completed tasks for payment). Exactly
 * one of `design_id` / `task_id` is expected to be set per row — enforced at
 * the workflow layer.
 */
const PaymentSubmissionItem = model.define("payment_submission_item", {
  id: model.id().primaryKey(),
  // Design source (nullable — may be a task-based item instead)
  design_id: model.text().nullable(),
  design_name: model.text().nullable(),
  // Task source (nullable — may be a design-based item instead)
  task_id: model.text().nullable(),
  task_name: model.text().nullable(),
  // Discriminator so consumers don't need to sniff which id is populated
  source_type: model
    .enum(["design", "task"])
    .default("design"),
  /**
   * What this line bills, in total. Authoritative — every reader sums `amount`
   * and nothing recomputes it from the two fields below.
   */
  amount: model.bigNumber(),
  /**
   * How many finished units this line pays for, and the rate per unit.
   *
   * 🔴 Added because the amount was previously a per-unit figure billed once.
   * `design.estimated_cost` / `production_cost` are PER FINISHED UNIT — see
   * `workflows/designs/estimate-design-cost.ts`, which divides a run total back
   * to per-unit precisely because that is what the column means. The submission
   * workflow then used that figure as the whole line amount with no multiplier,
   * so a design costed at 850/unit and produced nine times billed 850.
   *
   * Both are nullable/defaulted rather than required: rows written before this
   * existed carry a total and no breakdown, and a line whose amount was typed
   * directly (a partner override) has a total but no meaningful rate. A reader
   * that wants "9 × 850" must check `unit_amount != null` rather than dividing
   * `amount` by `quantity` and hoping.
   */
  quantity: model.float().default(1),
  unit_amount: model.bigNumber().nullable(),
  cost_breakdown: model.json().nullable(),
  /**
   * The production run(s) this line pays for, as an array of run ids.
   *
   * 🔴 A real column, deliberately NOT `metadata.production_run_id`. The
   * provenance of a payout decides whether the SAME run can be billed twice,
   * and `metadata` is validated as `z.record(z.string(), z.any())` everywhere
   * it is accepted — a misspelt key would validate cleanly and leave the
   * double-pay guard reading nothing. (#1557's lesson, applied to the field
   * that now guards the money rather than merely describing it.)
   *
   * An array rather than a single id because a submission line is keyed by
   * DESIGN: two completed runs of one design collapse into one item whose
   * quantity is their sum, and both run ids have to survive that.
   *
   * NULL on every row written before this existed, and on any line that was
   * not sourced from a run (a hand-picked design, a task). Absent means "no
   * run recorded", never "no run involved".
   */
  production_run_ids: model.json().nullable(),
  metadata: model.json().nullable(),
  submission: model.belongsTo(() => PaymentSubmission, {
    mappedBy: "items",
  }),
})

export default PaymentSubmissionItem
