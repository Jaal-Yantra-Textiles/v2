import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { PRODUCTION_RUNS_MODULE } from "../../../../modules/production_runs"
import type ProductionRunService from "../../../../modules/production_runs/service"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const id = req.params.id
  const productionRunService: ProductionRunService = req.scope.resolve(
    PRODUCTION_RUNS_MODULE
  )

  const run = await productionRunService.retrieveProductionRun(id)

  // Include tasks if link field exists
  let tasks: any[] = []
  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "production_runs",
      fields: ["*", "tasks.*"],
      filters: { id },
    })
    const node = (data || [])[0]
    tasks = node?.tasks || []
  } catch {
    // ignore if link not yet synced
  }

  return res.status(200).json({ production_run: run, tasks })
}
