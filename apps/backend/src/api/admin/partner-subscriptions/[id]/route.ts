import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PARTNER_PLAN_MODULE } from "../../../../modules/partner-plan"
import PartnerPlanService from "../../../../modules/partner-plan/service"
import { cancelPartnerSubscriptionWorkflow } from "../../../../workflows/partner-subscription/cancel-subscription"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const service: PartnerPlanService = req.scope.resolve(PARTNER_PLAN_MODULE)

  const subscription = await service.retrievePartnerSubscription(id, {
    relations: ["plan"],
  })

  res.json({ subscription })
}

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params

  const { result, errors } = await cancelPartnerSubscriptionWorkflow(
    req.scope
  ).run({ input: { subscription_id: id } })

  if (errors.length > 0) {
    throw errors[0]
  }

  res.json(result)
}
