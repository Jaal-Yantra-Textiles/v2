import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PARTNER_PLAN_MODULE } from "../../../../../modules/partner-plan"
import PartnerPlanService from "../../../../../modules/partner-plan/service"
import { SubscriptionPaymentStatus, SubscriptionStatus } from "../../../../../modules/partner-plan/types"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const service: PartnerPlanService = req.scope.resolve(PARTNER_PLAN_MODULE)

  const [payments, count] = await service.listAndCountSubscriptionPayments(
    { subscription_id: id } as any,
    {
      take: Number(req.query.limit) || 20,
      skip: Number(req.query.offset) || 0,
      order: { created_at: "DESC" },
    }
  )

  res.json({ payments, count })
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const service: PartnerPlanService = req.scope.resolve(PARTNER_PLAN_MODULE)
  const body = req.body as Record<string, any>

  // Fetch subscription to get plan details
  const subscription = await service.retrievePartnerSubscription(id, {
    relations: ["plan"],
  })

  const now = new Date()
  const periodEnd = new Date(subscription.current_period_end || now)
  const newPeriodEnd = new Date(periodEnd)
  newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1)

  // Record the payment
  const payment = await service.createSubscriptionPayments({
    subscription_id: id,
    amount: body.amount || (subscription.plan as any)?.price || 0,
    currency_code: body.currency_code || (subscription.plan as any)?.currency_code || "inr",
    status: SubscriptionPaymentStatus.COMPLETED,
    provider: body.provider || "manual",
    provider_reference_id: body.provider_reference_id || null,
    provider_data: body.provider_data || null,
    period_start: subscription.current_period_end || now,
    period_end: newPeriodEnd,
    paid_at: now,
    metadata: body.metadata || null,
  })

  // Extend subscription period and ensure active status
  await service.updatePartnerSubscriptions({
    id,
    status: SubscriptionStatus.ACTIVE,
    current_period_end: newPeriodEnd,
  })

  res.status(201).json({ payment, subscription_extended_to: newPeriodEnd })
}
