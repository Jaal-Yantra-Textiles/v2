import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { FEEDBACK_MODULE } from "../../modules/feedback"
import FeedbackService from "../../modules/feedback/service"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { AI_VTWO_MODULE } from "../../modules/aivtwo"
import AiVTwoService from "../../modules/aivtwo/service"

export type CreateFeedbackWithAiV2LinkInput = {
  rating: "one" | "two" | "three" | "four" | "five"
  comment?: string
  status?: "pending" | "reviewed" | "resolved"
  submitted_by: string
  submitted_at?: Date
  reviewed_by?: string
  reviewed_at?: Date
  metadata?: Record<string, any>
  link_to: {
    run_id: string
    resource_id?: string
    thread_id?: string
  }
}

export const ensureAiV2RunStep = createStep(
  "ensure-ai-v2-run-step",
  async (input: CreateFeedbackWithAiV2LinkInput["link_to"], { container }) => {
    const service: AiVTwoService = container.resolve(AI_VTWO_MODULE)
    const existing = await service.listAiVtwoRuns({ run_id: input.run_id })?.[0]
    if (existing?.id) {
      return new StepResponse({ id: existing.id }, null)
    }

    const created = await service.createAiVtwoRuns({
      run_id: input.run_id,
      resource_id: input.resource_id,
      thread_id: input.thread_id,
      status: "completed",
      metadata: {},
    })

    return new StepResponse({ id: created.id }, created.id)
  },
  async (createdId: string | null, { container }) => {
    if (!createdId) return
    const service: AiVTwoService = container.resolve(AI_VTWO_MODULE)
    await service.deleteAiVtwoRuns(createdId)
  }
)

export const createFeedbackStep = createStep(
  "create-feedback-with-ai-v2-link-step",
  async (input: CreateFeedbackWithAiV2LinkInput, { container }) => {
    const service: FeedbackService = container.resolve(FEEDBACK_MODULE)

    const { link_to, ...restInput } = input

    const feedbackInput = {
      rating: restInput.rating,
      comment: restInput.comment,
      status: restInput.status,
      submitted_by: restInput.submitted_by,
      submitted_at: restInput.submitted_at || new Date(),
      reviewed_by: restInput.reviewed_by,
      reviewed_at: restInput.reviewed_at,
      metadata: restInput.metadata,
    }

    const created = await service.createFeedbacks(feedbackInput)
    return new StepResponse({ feedback: created, link_to }, created.id)
  },
  async (id: string, { container }) => {
    const service: FeedbackService = container.resolve(FEEDBACK_MODULE)
    await service.softDeleteFeedbacks(id)
  }
)

export const linkFeedbackToAiV2RunStep = createStep(
  "link-feedback-to-ai-v2-run-step",
  async (input: { feedback_id: string; ai_vtwo_run_id: string }, { container }) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as any

    await remoteLink.create({
      [AI_VTWO_MODULE]: {
        ai_vtwo_run_id: input.ai_vtwo_run_id,
      },
      [FEEDBACK_MODULE]: {
        feedback_id: input.feedback_id,
      },
    })

    return new StepResponse({ linked: true }, input)
  },
  async (input: { feedback_id: string; ai_vtwo_run_id: string }, { container }) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as any
    await remoteLink.dismiss({
      [AI_VTWO_MODULE]: {
        ai_vtwo_run_id: input.ai_vtwo_run_id,
      },
      [FEEDBACK_MODULE]: {
        feedback_id: input.feedback_id,
      },
    })
  }
)

export const createFeedbackWithAiV2LinkWorkflow = createWorkflow(
  "create-feedback-with-ai-v2-link",
  (input: CreateFeedbackWithAiV2LinkInput) => {
    const run = ensureAiV2RunStep(input.link_to)

    const result = createFeedbackStep(input)

    const linkResult = linkFeedbackToAiV2RunStep({
      feedback_id: result.feedback.id,
      ai_vtwo_run_id: run.id,
    })

    return new WorkflowResponse({
      feedback: result.feedback,
      linkResult,
    })
  }
)
