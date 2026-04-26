import { MedusaContainer } from "@medusajs/framework/types"
import { PARTNER_PLAN_MODULE } from "../modules/partner-plan"
import PartnerPlanService from "../modules/partner-plan/service"
import {
  SubscriptionStatus,
  SubscriptionPaymentStatus,
  PaymentProvider,
} from "../modules/partner-plan/types"

/**
 * Subscription Renewal & Expiry Check
 *
 * Runs daily at midnight to:
 * 1. Auto-renew free plan subscriptions
 * 2. Mark paid plan subscriptions as past_due if payment not received
 * 3. Expire subscriptions that are past_due for 7+ days
 */
export default async function checkSubscriptionExpiry(
  container: MedusaContainer
) {
  const logger = container.resolve("logger")
  const service: PartnerPlanService = container.resolve(PARTNER_PLAN_MODULE)

  try {
    const now = new Date()

    const [subscriptions] = await service.listAndCountPartnerSubscriptions(
      {},
      { take: 500, relations: ["plan", "payments"] }
    )

    let renewed = 0
    let pastDue = 0
    let expired = 0

    for (const sub of subscriptions) {
      if (sub.status !== SubscriptionStatus.ACTIVE && sub.status !== SubscriptionStatus.PAST_DUE) {
        continue
      }

      if (!sub.current_period_end || new Date(sub.current_period_end) > now) {
        continue // Not due yet
      }

      const plan = sub.plan as any

      // Free plans — auto-renew silently
      if (plan && plan.price === 0) {
        const newEnd = new Date(now)
        newEnd.setMonth(newEnd.getMonth() + 1)

        await service.updatePartnerSubscriptions({
          id: sub.id,
          status: SubscriptionStatus.ACTIVE,
          current_period_start: now,
          current_period_end: newEnd,
        })

        // Record a $0 payment record
        await service.createSubscriptionPayments({
          subscription_id: sub.id,
          amount: 0,
          currency_code: plan.currency_code || "inr",
          status: SubscriptionPaymentStatus.COMPLETED,
          provider: PaymentProvider.MANUAL,
          period_start: now,
          period_end: newEnd,
          paid_at: now,
        })

        renewed++
        continue
      }

      // Paid plans — check if already past_due
      if (sub.status === SubscriptionStatus.PAST_DUE) {
        // If past_due for more than 7 days, expire
        const periodEnd = new Date(sub.current_period_end)
        const daysPastDue = Math.floor(
          (now.getTime() - periodEnd.getTime()) / (1000 * 60 * 60 * 24)
        )

        if (daysPastDue > 7) {
          await service.updatePartnerSubscriptions({
            id: sub.id,
            status: SubscriptionStatus.EXPIRED,
          })
          expired++
        }
        continue
      }

      // Active paid plan that just expired — mark as past_due
      // The partner needs to make a payment to renew
      await service.updatePartnerSubscriptions({
        id: sub.id,
        status: SubscriptionStatus.PAST_DUE,
      })

      // Create a pending payment record
      const newEnd = new Date(now)
      newEnd.setMonth(newEnd.getMonth() + 1)

      await service.createSubscriptionPayments({
        subscription_id: sub.id,
        amount: plan.price,
        currency_code: plan.currency_code || "inr",
        status: SubscriptionPaymentStatus.PENDING,
        provider: sub.payment_provider || PaymentProvider.MANUAL,
        period_start: now,
        period_end: newEnd,
      })

      pastDue++
    }

    if (renewed + pastDue + expired > 0) {
      logger.info(
        `[subscription-check] Renewed: ${renewed}, Past-due: ${pastDue}, Expired: ${expired}`
      )
    }
  } catch (e) {
    logger.error("[subscription-check] Error:", e)
  }
}

export const config = {
  name: "check-subscription-expiry",
  schedule: "0 0 * * *", // Daily at midnight
}
