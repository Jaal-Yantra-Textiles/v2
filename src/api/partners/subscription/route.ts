import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { PARTNER_PLAN_MODULE } from "../../../modules/partner-plan"
import PartnerPlanService from "../../../modules/partner-plan/service"
import { getPartnerFromAuthContext } from "../helpers"
import { createPartnerSubscriptionWorkflow } from "../../../workflows/partner-subscription/create-subscription"
import { cancelPartnerSubscriptionWorkflow } from "../../../workflows/partner-subscription/cancel-subscription"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(
    req.auth_context,
    req.scope
  )

  if (!partner) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "No partner associated with this account"
    )
  }

  const service: PartnerPlanService = req.scope.resolve(PARTNER_PLAN_MODULE)

  // Get active subscription with payments
  const [subscriptions] = await service.listAndCountPartnerSubscriptions(
    { partner_id: partner.id, status: "active" as any },
    { take: 1, relations: ["plan", "payments"] }
  )

  const subscription = subscriptions[0] || null

  // Also return available plans
  const [plans] = await service.listAndCountPartnerPlans(
    { is_active: true },
    { order: { sort_order: "ASC" }, take: 100 }
  )

  // Determine which payment provider the partner should use
  // India-based partners → PayU, international → Stripe
  const partnerCurrency = (partner.metadata as any)?.currency_code || "inr"
  const recommended_provider = partnerCurrency === "inr" ? "payu" : "stripe"

  res.json({ subscription, plans, recommended_provider })
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(
    req.auth_context,
    req.scope
  )

  if (!partner) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "No partner associated with this account"
    )
  }

  const { plan_id } = req.validatedBody as { plan_id: string }

  // Verify plan exists and is active
  const service: PartnerPlanService = req.scope.resolve(PARTNER_PLAN_MODULE)
  const plan = await service.retrievePartnerPlan(plan_id)

  if (!plan || !plan.is_active) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Plan not found or is inactive"
    )
  }

  const { result, errors } = await createPartnerSubscriptionWorkflow(
    req.scope
  ).run({
    input: {
      partner_id: partner.id,
      plan_id,
    },
  })

  if (errors.length > 0) {
    throw errors[0]
  }

  res.status(201).json(result)
}

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(
    req.auth_context,
    req.scope
  )

  if (!partner) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "No partner associated with this account"
    )
  }

  const service: PartnerPlanService = req.scope.resolve(PARTNER_PLAN_MODULE)

  const [subscriptions] = await service.listAndCountPartnerSubscriptions(
    { partner_id: partner.id, status: "active" },
    { take: 1 }
  )

  if (!subscriptions.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "No active subscription found"
    )
  }

  const { result, errors } = await cancelPartnerSubscriptionWorkflow(
    req.scope
  ).run({
    input: { subscription_id: subscriptions[0].id },
  })

  if (errors.length > 0) {
    throw errors[0]
  }

  res.json(result)
}
