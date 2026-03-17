import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { PARTNER_PLAN_MODULE } from "../../modules/partner-plan"
import PartnerPlanService from "../../modules/partner-plan/service"

export type CancelPartnerSubscriptionInput = {
  subscription_id: string
}

const cancelSubscriptionStep = createStep(
  "cancel-partner-subscription-step",
  async (input: CancelPartnerSubscriptionInput, { container }) => {
    const service: PartnerPlanService = container.resolve(PARTNER_PLAN_MODULE)

    const subscription = await service.retrievePartnerSubscription(
      input.subscription_id,
      { relations: ["plan"] }
    )

    await service.updatePartnerSubscriptions({
      selector: { id: input.subscription_id },
      data: {
        status: "canceled",
        canceled_at: new Date(),
      },
    })

    return new StepResponse(
      { subscription: { ...subscription, status: "canceled" } },
      { subscription_id: input.subscription_id, previous_status: subscription.status }
    )
  },
  async (data, { container }) => {
    if (!data) return
    const service: PartnerPlanService = container.resolve(PARTNER_PLAN_MODULE)

    await service.updatePartnerSubscriptions({
      selector: { id: data.subscription_id },
      data: {
        status: data.previous_status,
        canceled_at: null,
      },
    })
  }
)

export const cancelPartnerSubscriptionWorkflow = createWorkflow(
  "cancel-partner-subscription",
  (input: CancelPartnerSubscriptionInput) => {
    const { subscription } = cancelSubscriptionStep(input)
    return new WorkflowResponse({ subscription })
  }
)
