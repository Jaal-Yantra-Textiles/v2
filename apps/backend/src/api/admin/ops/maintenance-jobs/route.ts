import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { MAINTENANCE_JOBS } from "./registry"

/**
 * GET /admin/ops/maintenance-jobs
 *
 * Lists the available data-plumbing maintenance jobs and their parameters so an
 * admin Ops console (or a script) can discover what's runnable. (#457)
 */
export const GET = async (_req: MedusaRequest, res: MedusaResponse) => {
  res.json({
    jobs: MAINTENANCE_JOBS.map((job) => ({
      id: job.id,
      label: job.label,
      description: job.description,
      params: job.params,
    })),
    count: MAINTENANCE_JOBS.length,
  })
}
