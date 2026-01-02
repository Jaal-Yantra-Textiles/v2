import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import {
  dispatchProductionRunWorkflow,
} from "../../../../../workflows/production-runs/dispatch-production-run"
import type { AdminStartDispatchProductionRunReq } from "../../validators"

export const POST = async (
  req: MedusaRequest<AdminStartDispatchProductionRunReq>,
  res: MedusaResponse
) => {
  const id = req.params.id

  const { transaction } = await dispatchProductionRunWorkflow(req.scope).run({
    input: {
      production_run_id: id,
    },
  })

  return res.status(202).json({ transaction_id: transaction.transactionId })
}
