import { model } from "@medusajs/framework/utils"

/**
 * #2451 — a partner task done FOR a production run by a partner who is not the run's
 * own maker — a photographer's shoot for a weaver's run, say.
 *
 * 🔴 Deliberately NOT the `production-runs-tasks` link. Every reader of that
 * link assumes the task is one of the run's own steps, done by `run.partner_id`:
 * completing the run force-completes its linked tasks (which makes them
 * payable), cancel / reassign / decline cancel them, the run's partner sees
 * them (costs included) in their app, and the last open one decides when the
 * run auto-completes. A foreign partner's task must stay out of all of that,
 * so it gets its own table that none of those readers see.
 *
 * The task still belongs to its partner through `partner-task`, so it is
 * listed, finished and paid exactly like any other partner task.
 */
const ProductionRunPartnerTask = model
  .define("production_run_partner_task", {
    id: model.id({ prefix: "prun_ptask" }).primaryKey(),
    production_run_id: model.text().searchable(),
    task_id: model.text(),
    /** The partner doing the task, kept for reads that start from the run. */
    partner_id: model.text().nullable(),
  })
  .indexes([
    { on: ["production_run_id"] },
    {
      // A task is done for at most one run.
      on: ["task_id"],
      unique: true,
      where: "deleted_at IS NULL",
    },
  ])

export default ProductionRunPartnerTask
