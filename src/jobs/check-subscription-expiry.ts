import { MedusaContainer } from "@medusajs/framework/types"
import { PARTNER_PLAN_MODULE } from "../modules/partner-plan"
import PartnerPlanService from "../modules/partner-plan/service"

/**
 * Subscription Expiry Check
 *
 * Runs daily at midnight to:
 * 1. Mark expired subscriptions (past current_period_end)
 * 2. Could be extended to handle auto-renewal with payment capture
 */
export default async function checkSubscriptionExpiry(
  container: MedusaContainer
) {
  const logger = container.resolve("logger")
  const service: PartnerPlanService = container.resolve(PARTNER_PLAN_MODULE)

  try {
    const now = new Date()

    // Find active subscriptions whose period has ended
    const [subscriptions] = await service.listAndCountPartnerSubscriptions(
      { status: "active" },
      { take: 500, relations: ["plan"] }
    )

    let expired = 0

    for (const sub of subscriptions) {
      if (sub.current_period_end && new Date(sub.current_period_end) < now) {
        // For free plans (price = 0), auto-renew
        const plan = sub.plan as any
        if (plan && plan.price === 0) {
          const newEnd = new Date(now)
          newEnd.setMonth(newEnd.getMonth() + 1)

          await service.updatePartnerSubscriptions({
            selector: { id: sub.id },
            data: {
              current_period_start: now,
              current_period_end: newEnd,
            },
          })
        } else {
          // For paid plans, mark as expired (payment integration needed)
          await service.updatePartnerSubscriptions({
            selector: { id: sub.id },
            data: { status: "expired" },
          })
          expired++
        }
      }
    }

    if (expired > 0) {
      logger.info(`[subscription-expiry] Marked ${expired} subscriptions as expired`)
    }
  } catch (e) {
    logger.error("[subscription-expiry] Error checking subscriptions:", e)
  }
}

export const config = {
  name: "check-subscription-expiry",
  schedule: "0 0 * * *", // Daily at midnight
}
