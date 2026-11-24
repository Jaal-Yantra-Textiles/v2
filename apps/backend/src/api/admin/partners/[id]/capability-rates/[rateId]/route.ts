/** #2596 — edit or remove one rate estimate. A rate of another partner 404s. */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import {
  deleteCapabilityRateWorkflow,
  updateCapabilityRateWorkflow,
} from "../../../../../../workflows/partner/capability-rates"
import type { AdminUpdateCapabilityRateReq } from "../validators"

export const POST = async (
  req: MedusaRequest<AdminUpdateCapabilityRateReq>,
  res: MedusaResponse
) => {
  const { result } = await updateCapabilityRateWorkflow(req.scope).run({
    input: {
      ...(req.validatedBody as AdminUpdateCapabilityRateReq),
      partner_id: req.params.id,
      rate_id: req.params.rateId,
    },
  })
  res.json(result)
}

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const { result } = await deleteCapabilityRateWorkflow(req.scope).run({
    input: { partner_id: req.params.id, rate_id: req.params.rateId },
  })
  res.json(result)
}
