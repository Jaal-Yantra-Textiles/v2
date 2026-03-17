import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PARTNER_PLAN_MODULE } from "../../../modules/partner-plan"
import PartnerPlanService from "../../../modules/partner-plan/service"
import { createPartnerSubscriptionWorkflow } from "../../../workflows/partner-subscription/create-subscription"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: PartnerPlanService = req.scope.resolve(PARTNER_PLAN_MODULE)

  const limit = Number(req.query.limit) || 20
  const offset = Number(req.query.offset) || 0
  const partner_id = req.query.partner_id as string | undefined

  const filters: Record<string, unknown> = {}
  if (partner_id) filters.partner_id = partner_id

  const [subscriptions, count] = await service.listAndCountPartnerSubscriptions(
    filters,
    {
      take: limit,
      skip: offset,
      relations: ["plan"],
      order: { created_at: "DESC" },
    }
  )

  res.json({ subscriptions, count, offset, limit })
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const data = req.validatedBody as {
    partner_id: string
    plan_id: string
    metadata?: Record<string, unknown>
  }

  const { result, errors } = await createPartnerSubscriptionWorkflow(
    req.scope
  ).run({ input: data })

  if (errors.length > 0) {
    throw errors[0]
  }

  res.status(201).json(result)
}
