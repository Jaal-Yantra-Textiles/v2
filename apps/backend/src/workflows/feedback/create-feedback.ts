import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { FEEDBACK_MODULE } from "../../modules/feedback";
import FeedbackService from "../../modules/feedback/service";
import { emitEventStep } from "@medusajs/medusa/core-flows";

export type CreateFeedbackStepInput = {
  rating: "one" | "two" | "three" | "four" | "five";
  comment?: string;
  status?: "pending" | "reviewed" | "resolved";
  submitted_by: string;
  submitted_at?: Date;
  reviewed_by?: string;
  reviewed_at?: Date;
  metadata?: Record<string, any>;
};

export const createFeedbackStep = createStep(
  "create-feedback-step",
  async (input: CreateFeedbackStepInput, { container }) => {
    const service: FeedbackService = container.resolve(FEEDBACK_MODULE);
    const created = await service.createFeedbacks(input);
    return new StepResponse(created, created.id);
  },
  async (id: string, { container }) => {
    const service: FeedbackService = container.resolve(FEEDBACK_MODULE);
    await service.softDeleteFeedbacks(id);
  }
);

export type CreateFeedbackWorkflowInput = CreateFeedbackStepInput;

export const createFeedbackWorkflow = createWorkflow(
  "create-feedback",
  (input: CreateFeedbackWorkflowInput) => {
    const result = createFeedbackStep(input);
    emitEventStep({
      eventName: 'feedback.feedback.created',
      data: {
        id: result.id
      }
    })
    return new WorkflowResponse(result);
  }
);
