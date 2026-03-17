import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { PARTNER_PLAN_MODULE } from "../modules/partner-plan"
import PartnerPlanService from "../modules/partner-plan/service"
import {
  PaymentProvider,
  SubscriptionPaymentStatus,
  SubscriptionStatus,
} from "../modules/partner-plan/types"
import { createPartnerSubscriptionWorkflow } from "../workflows/partner-subscription/create-subscription"

/**
 * Assigns a plan to a partner and records an initial payment.
 *
 * Usage:
 *   npx medusa exec src/scripts/assign-plan-to-partner.ts
 *
 * Edit the PARTNER_HANDLE and PLAN_SLUG constants below before running.
 */

// ---- CONFIGURE THESE ----
const PARTNER_HANDLE = "sharlho" // The partner's handle
const PLAN_SLUG = "simple" // simple | pro | max
const PAYMENT_PROVIDER = "payu" // payu | stripe | manual
// -------------------------

export default async function assignPlanToPartner({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const service: PartnerPlanService = container.resolve(PARTNER_PLAN_MODULE)

  // Find partner
  const { data: partners } = await query.graph({
    entity: "partners",
    fields: ["id", "name", "handle", "metadata"],
    filters: { handle: PARTNER_HANDLE },
  })

  if (!partners?.length) {
    logger.error(`Partner with handle "${PARTNER_HANDLE}" not found.`)
    logger.info("Available partners:")
    const { data: all } = await query.graph({
      entity: "partners",
      fields: ["handle", "name"],
    })
    for (const p of (all || [])) {
      logger.info(`  ${(p as any).handle} — ${(p as any).name}`)
    }
    return
  }

  const partner = partners[0] as any
  logger.info(`Found partner: ${partner.name} (${partner.handle}, ${partner.id})`)

  // Find plan
  const [plans] = await service.listAndCountPartnerPlans(
    { slug: PLAN_SLUG },
    { take: 1 }
  )

  if (!plans.length) {
    logger.error(`Plan "${PLAN_SLUG}" not found. Run seed-partner-plans first.`)
    return
  }

  const plan = plans[0] as any
  logger.info(`Found plan: ${plan.name} (${plan.slug}, ₹${plan.price}/${plan.interval})`)

  // Check existing subscription
  const [existing] = await service.listAndCountPartnerSubscriptions(
    { partner_id: partner.id, status: SubscriptionStatus.ACTIVE },
    { take: 1, relations: ["plan"] }
  )

  if (existing.length) {
    const currentPlan = (existing[0] as any).plan
    logger.info(
      `Partner already has active subscription: ${currentPlan?.name || "unknown"}`
    )
    logger.info(`Replacing with ${plan.name}...`)
  }

  // Create subscription
  const { result } = await createPartnerSubscriptionWorkflow(container).run({
    input: {
      partner_id: partner.id,
      plan_id: plan.id,
      payment_provider: PAYMENT_PROVIDER,
    },
  })

  const sub = (result as any).subscription
  logger.info(`Created subscription: ${sub.id}`)
  logger.info(`  Status: ${sub.status}`)
  logger.info(`  Provider: ${PAYMENT_PROVIDER}`)
  logger.info(`  Period: ${sub.current_period_start} → ${sub.current_period_end}`)

  // Record initial payment for paid plans
  if (plan.price > 0) {
    const now = new Date()
    const periodEnd = new Date(now)
    periodEnd.setMonth(periodEnd.getMonth() + 1)

    await service.createSubscriptionPayments({
      subscription_id: sub.id,
      amount: plan.price,
      currency_code: plan.currency_code,
      status: SubscriptionPaymentStatus.COMPLETED,
      provider: PAYMENT_PROVIDER as PaymentProvider,
      period_start: now,
      period_end: periodEnd,
      paid_at: now,
      metadata: { note: "Initial subscription payment (manual assignment)" },
    })
    logger.info(`  Recorded initial payment: ₹${plan.price}`)
  }

  logger.info("Done.")
}
