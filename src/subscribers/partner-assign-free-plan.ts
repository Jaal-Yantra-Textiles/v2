import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { PARTNER_PLAN_MODULE } from "../modules/partner-plan"
import PartnerPlanService from "../modules/partner-plan/service"
import { createPartnerSubscriptionWorkflow } from "../workflows/partner-subscription/create-subscription"

export default async function partnerAssignFreePlanHandler({
  event: { data },
  container,
}: SubscriberArgs<{
  partner_id: string
  partner_admin_id: string
  email: string
  temp_password: string
}>) {
  const service: PartnerPlanService = container.resolve(PARTNER_PLAN_MODULE)

  // Find the free plan (Simple)
  const [plans] = await service.listAndCountPartnerPlans(
    { slug: "simple" },
    { take: 1 }
  )

  if (!plans.length) {
    // No free plan seeded yet, skip
    return
  }

  // Check if partner already has a subscription
  const [existing] = await service.listAndCountPartnerSubscriptions(
    { partner_id: data.partner_id, status: "active" },
    { take: 1 }
  )

  if (existing.length) {
    // Already has an active subscription
    return
  }

  // Assign the free plan
  try {
    await createPartnerSubscriptionWorkflow(container).run({
      input: {
        partner_id: data.partner_id,
        plan_id: plans[0].id,
      },
    })
  } catch (e) {
    // Don't block partner creation if subscription assignment fails
    console.error("Failed to assign free plan to partner:", e)
  }
}

export const config: SubscriberConfig = {
  event: "partner.created.fromAdmin",
}
