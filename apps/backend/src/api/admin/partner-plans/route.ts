import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PARTNER_PLAN_MODULE } from "../../../modules/partner-plan"
import PartnerPlanService from "../../../modules/partner-plan/service"
import { seedPartnerPlansWorkflow } from "../../../workflows/partner-subscription/seed-plans"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: PartnerPlanService = req.scope.resolve(PARTNER_PLAN_MODULE)

  const [plans, count] = await service.listAndCountPartnerPlans(
    {},
    {
      order: { sort_order: "ASC" },
      take: 100,
    }
  )

  res.json({ plans, count })
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: PartnerPlanService = req.scope.resolve(PARTNER_PLAN_MODULE)

  const data = req.validatedBody as any
  const [plan] = await service.createPartnerPlans([data])

  res.status(201).json({ plan })
}
