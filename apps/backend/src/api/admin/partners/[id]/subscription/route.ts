import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { PARTNER_PLAN_MODULE } from "../../../../../modules/partner-plan"
import PartnerPlanService from "../../../../../modules/partner-plan/service"
import { createPartnerSubscriptionWorkflow } from "../../../../../workflows/partner-subscription/create-subscription"
import { cancelPartnerSubscriptionWorkflow } from "../../../../../workflows/partner-subscription/cancel-subscription"
import { SubscriptionPaymentStatus, PaymentProvider } from "../../../../../modules/partner-plan/types"

/**
 * GET /admin/partners/:id/subscription
 * List all subscriptions for a partner (with plan and payments).
 */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { id: partnerId } = req.params
  const service: PartnerPlanService = req.scope.resolve(PARTNER_PLAN_MODULE)

  const [subscriptions] = await service.listAndCountPartnerSubscriptions(
    { partner_id: partnerId },
    { take: 50, relations: ["plan", "payments"], order: { created_at: "DESC" } }
  )

  const [plans] = await service.listAndCountPartnerPlans(
    { is_active: true },
    { order: { sort_order: "ASC" }, take: 100 }
  )

  res.json({ subscriptions, plans })
}

/**
 * POST /admin/partners/:id/subscription
 * Admin: create/assign a subscription for a partner.
 * Body: { plan_id, payment_provider?, skip_payment? }
 */
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { id: partnerId } = req.params
  const body = req.body as {
    plan_id: string
    payment_provider?: string
    skip_payment?: boolean
    notes?: string
  }

  if (!body.plan_id) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "plan_id is required")
  }

  const service: PartnerPlanService = req.scope.resolve(PARTNER_PLAN_MODULE)
  const plan = await service.retrievePartnerPlan(body.plan_id)

  if (!plan || !plan.is_active) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Plan not found or inactive")
  }

  // Create subscription (admin can skip payment for comp/trial)
  const { result, errors } = await createPartnerSubscriptionWorkflow(req.scope).run({
    input: {
      partner_id: partnerId,
      plan_id: body.plan_id,
      payment_provider: body.payment_provider || "manual",
      metadata: body.notes ? { admin_notes: body.notes } : undefined,
    },
  })

  if (errors.length > 0) throw errors[0]

  // If admin created it manually and plan has a cost, record a manual payment
  if (plan.price > 0 && body.skip_payment) {
    await service.createSubscriptionPayments({
      amount: plan.price,
      currency_code: plan.currency_code || "inr",
      status: SubscriptionPaymentStatus.COMPLETED,
      provider: PaymentProvider.MANUAL,
      provider_reference_id: `admin_comp_${Date.now()}`,
      provider_data: { admin_assigned: true, notes: body.notes },
      period_start: new Date(),
      period_end: (() => { const d = new Date(); d.setMonth(d.getMonth() + 1); return d })(),
      paid_at: new Date(),
      subscription_id: (result as any).subscription?.id,
    })
  }

  res.status(201).json(result)
}

/**
 * DELETE /admin/partners/:id/subscription
 * Admin: cancel the partner's active subscription.
 */
export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { id: partnerId } = req.params
  const service: PartnerPlanService = req.scope.resolve(PARTNER_PLAN_MODULE)

  const [subscriptions] = await service.listAndCountPartnerSubscriptions(
    { partner_id: partnerId, status: "active" },
    { take: 1 }
  )

  if (!subscriptions.length) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "No active subscription")
  }

  const { result, errors } = await cancelPartnerSubscriptionWorkflow(req.scope).run({
    input: { subscription_id: subscriptions[0].id },
  })

  if (errors.length > 0) throw errors[0]
  res.json(result)
}
