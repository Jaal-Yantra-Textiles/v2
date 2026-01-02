import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { sendProductionRunToProductionWorkflow } from "../../../../../workflows/production-runs/send-production-run-to-production"
import type { AdminSendProductionRunToProductionReq } from "../../validators"

export const POST = async (
  req: MedusaRequest<AdminSendProductionRunToProductionReq>,
  res: MedusaResponse
) => {
  const id = req.params.id
  const body = (req as any).validatedBody || req.body

  const { result } = await sendProductionRunToProductionWorkflow(req.scope).run({
    input: {
      production_run_id: id,
      template_names: body.template_names,
    },
  })

  return res.status(200).json({ result })
}
