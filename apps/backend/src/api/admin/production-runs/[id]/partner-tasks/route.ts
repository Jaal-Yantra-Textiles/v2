import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { retrieveRunOrThrow } from "../../../../../workflows/production-runs/lib/profit-share-store"
import { listRunPartnerTasks } from "../../../../../workflows/production-runs/lib/run-partner-tasks"

/**
 * GET /admin/production-runs/:id/partner-tasks
 *
 * Partner tasks done FOR this run (a shoot, a finishing job), by any partner.
 * These are not the run's own steps: they never decide when the run completes,
 * and completing or cancelling the run leaves them alone.
 */
export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const run = await retrieveRunOrThrow(req.scope, req.params.id)
  const partner_tasks = await listRunPartnerTasks(req.scope, run.id)
  res.json({ partner_tasks, count: partner_tasks.length })
}
