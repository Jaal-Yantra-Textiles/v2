import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  transform,
  when,
} from "@medusajs/framework/workflows-sdk"

import { FEEDBACK_MODULE } from "../../modules/feedback"
import type FeedbackService from "../../modules/feedback/service"
import { retrieveShipmentDetailsStep } from "../email/steps/retrieve-shipment-details"
import { fetchEmailTemplateStep } from "../email/steps/fetch-email-template"
import { sendNotificationEmailStep } from "../email/steps/send-notification-email"
import {
  buildPostDeliveryFeedbackEmailData,
  resolveFeedbackStoreBase,
  selectExistingFeedbackRequest,
} from "./lib/post-delivery-feedback"

export interface RequestPostDeliveryFeedbackInput {
  /** The delivered fulfillment (delivery.created carries this as `id`). */
  shipment_id: string
  /** Optional override for the storefront base used in the feedback link. */
  store_base?: string
}

/**
 * Idempotently create (or reuse) a pending feedback request tied to the order.
 * Uses the durable `order_id` column (#452) for the idempotency lookup so a
 * re-delivered/re-emitted event never produces a duplicate request.
 */
const createFeedbackRequestStep = createStep(
  "create-post-delivery-feedback-request",
  async (
    { order_id, submitted_by }: { order_id: string; submitted_by: string },
    { container }
  ) => {
    const service = container.resolve(FEEDBACK_MODULE) as FeedbackService

    const existingRows = await service.listFeedbacks({ order_id })
    const existing = selectExistingFeedbackRequest(existingRows as any)
    if (existing) {
      return new StepResponse({ feedback: existing, created: false }, null)
    }

    const created = await service.createFeedbacks({
      order_id,
      submitted_by: submitted_by || "customer",
      submitted_at: new Date(),
      status: "pending",
      metadata: { source: "post_delivery_request" },
    })

    return new StepResponse({ feedback: created, created: true }, created.id)
  },
  // Compensation: only undo what we created.
  async (createdId: string | null, { container }) => {
    if (!createdId) {
      return
    }
    const service = container.resolve(FEEDBACK_MODULE) as FeedbackService
    await service.softDeleteFeedbacks(createdId)
  }
)

export const requestPostDeliveryFeedbackWorkflow = createWorkflow(
  { name: "request-post-delivery-feedback", store: true },
  (input: RequestPostDeliveryFeedbackInput) => {
    const shipmentData = retrieveShipmentDetailsStep({
      shipment_id: input.shipment_id,
    })

    const feedbackResult = createFeedbackRequestStep(
      transform({ shipmentData }, ({ shipmentData }) => ({
        order_id: shipmentData.order.id,
        submitted_by: shipmentData.customer_email || shipmentData.order.id,
      }))
    )

    const emailInput = transform(
      { shipmentData, feedbackResult, input },
      ({ shipmentData, feedbackResult, input }) => {
        const storeBase = resolveFeedbackStoreBase(
          process.env as Record<string, string | undefined>,
          input.store_base
        )
        const email = buildPostDeliveryFeedbackEmailData({
          order: shipmentData.order,
          customerName: shipmentData.customer_name,
          feedbackId: feedbackResult.feedback.id,
          storeBase,
        })
        return {
          to: email.to,
          template: email.template,
          data: email.data,
          has_recipient: !!email.to,
        }
      }
    )

    // Only send when the order actually has a customer email.
    when({ emailInput }, ({ emailInput }) => emailInput.has_recipient).then(() => {
      const templateData = fetchEmailTemplateStep({
        templateKey: "order-feedback-request",
        data: emailInput.data as unknown as Record<string, any>,
      })

      const emailWithTemplate = transform(
        { emailInput, templateData },
        ({ emailInput, templateData }) => ({
          to: emailInput.to,
          template: emailInput.template,
          data: emailInput.data,
          templateData,
        })
      )

      sendNotificationEmailStep(emailWithTemplate as any)
    })

    return new WorkflowResponse(feedbackResult)
  }
)
