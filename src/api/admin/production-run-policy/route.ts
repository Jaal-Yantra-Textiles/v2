import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { PRODUCTION_POLICY_MODULE } from "../../../modules/production_policy"
import type ProductionPolicyService from "../../../modules/production_policy/service"

import type { AdminUpdateProductionRunPolicyReq } from "./validators"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const productionPolicyService: ProductionPolicyService = req.scope.resolve(
    PRODUCTION_POLICY_MODULE
  )

  const policy = await productionPolicyService.getOrCreatePolicy()

  return res.status(200).json({ policy })
}

export const PUT = async (
  req: MedusaRequest<AdminUpdateProductionRunPolicyReq>,
  res: MedusaResponse
) => {
  const productionPolicyService: ProductionPolicyService = req.scope.resolve(
    PRODUCTION_POLICY_MODULE
  )

  const body = (req as any).validatedBody || req.body

  const policy = await productionPolicyService.updatePolicy({
    config: body?.config ?? null,
  })

  return res.status(200).json({ policy })
}
