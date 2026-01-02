import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { approveProductionRunWorkflow } from "../../../../../workflows/production-runs/approve-production-run"
import type { AdminApproveProductionRunReq } from "../../validators"

export const POST = async (
  req: MedusaRequest<AdminApproveProductionRunReq>,
  res: MedusaResponse
) => {
  const id = req.params.id
  const body = (req as any).validatedBody || req.body

  const { result } = await approveProductionRunWorkflow(req.scope).run({
    input: {
      production_run_id: id,
      assignments: body.assignments,
    },
  })

  return res.status(200).json({ result })
}
