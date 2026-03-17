import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PARTNER_PLAN_MODULE } from "../../../../modules/partner-plan"
import PartnerPlanService from "../../../../modules/partner-plan/service"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const service: PartnerPlanService = req.scope.resolve(PARTNER_PLAN_MODULE)

  const plan = await service.retrievePartnerPlan(id)

  res.json({ plan })
}

export const PUT = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const service: PartnerPlanService = req.scope.resolve(PARTNER_PLAN_MODULE)

  const data = req.validatedBody as any

  const updated = await service.updatePartnerPlans({
    selector: { id },
    data,
  })

  res.json({ plan: updated[0] })
}

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const service: PartnerPlanService = req.scope.resolve(PARTNER_PLAN_MODULE)

  await service.deletePartnerPlans([id])

  res.status(200).json({ id, deleted: true })
}
