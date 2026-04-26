import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { PARTNER_PLAN_MODULE } from "../../modules/partner-plan"
import PartnerPlanService from "../../modules/partner-plan/service"
import { PaymentProvider, SubscriptionStatus } from "../../modules/partner-plan/types"

export type CreatePartnerSubscriptionInput = {
  partner_id: string
  plan_id: string
  payment_provider?: string
  metadata?: Record<string, unknown>
}

const createSubscriptionStep = createStep(
  "create-partner-subscription-step",
  async (input: CreatePartnerSubscriptionInput, { container }) => {
    const service: PartnerPlanService = container.resolve(PARTNER_PLAN_MODULE)

    // Cancel any existing active subscriptions for this partner
    const [existing] = await service.listAndCountPartnerSubscriptions(
      { partner_id: input.partner_id, status: SubscriptionStatus.ACTIVE },
      { take: 10 }
    )

    for (const sub of existing) {
      await service.updatePartnerSubscriptions(
        { id: sub.id, status: SubscriptionStatus.CANCELED, canceled_at: new Date() }
      )
    }

    const now = new Date()
    const periodEnd = new Date(now)
    periodEnd.setMonth(periodEnd.getMonth() + 1)

    const subscription = await service.createPartnerSubscriptions({
      partner_id: input.partner_id,
      plan_id: input.plan_id,
      status: SubscriptionStatus.ACTIVE,
      payment_provider: (input.payment_provider as PaymentProvider) || PaymentProvider.MANUAL,
      current_period_start: now,
      current_period_end: periodEnd,
      metadata: input.metadata || null,
    })

    return new StepResponse(
      { subscription, canceled_ids: existing.map((s: any) => s.id) },
      { subscription_id: (subscription as any).id, canceled_ids: existing.map((s: any) => s.id) }
    )
  },
  async (data, { container }) => {
    if (!data) return
    const service: PartnerPlanService = container.resolve(PARTNER_PLAN_MODULE)

    await service.deletePartnerSubscriptions([data.subscription_id])

    for (const id of data.canceled_ids) {
      await service.updatePartnerSubscriptions(
        { id, status: SubscriptionStatus.ACTIVE, canceled_at: null }
      )
    }
  }
)

const linkSubscriptionStep = createStep(
  "link-partner-subscription-step",
  async (
    input: { partner_id: string; subscription_id: string },
    { container }
  ) => {
    const link: any = container.resolve(ContainerRegistrationKeys.REMOTE_LINK)

    await link.create({
      partner: { partner_id: input.partner_id },
      [PARTNER_PLAN_MODULE]: {
        partner_subscription_id: input.subscription_id,
      },
    })

    return new StepResponse(input)
  },
  async (data, { container }) => {
    if (!data) return
    const link: any = container.resolve(ContainerRegistrationKeys.REMOTE_LINK)

    await link.dismiss({
      partner: { partner_id: data.partner_id },
      [PARTNER_PLAN_MODULE]: {
        partner_subscription_id: data.subscription_id,
      },
    })
  }
)

export const createPartnerSubscriptionWorkflow = createWorkflow(
  "create-partner-subscription",
  (input: CreatePartnerSubscriptionInput) => {
    const { subscription } = createSubscriptionStep(input)

    linkSubscriptionStep({
      partner_id: input.partner_id,
      subscription_id: subscription.id,
    })

    return new WorkflowResponse({ subscription })
  }
)
