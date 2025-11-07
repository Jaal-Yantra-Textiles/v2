import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { FEEDBACK_MODULE } from "../../modules/feedback";
import FeedbackService from "../../modules/feedback/service";

export type DeleteFeedbackStepInput = {
  id: string;
};

export const deleteFeedbackStep = createStep(
  "delete-feedback-step",
  async (input: DeleteFeedbackStepInput, { container }) => {
    const service: FeedbackService = container.resolve(FEEDBACK_MODULE);
    const original = await service.retrieveFeedback(input.id);

    await service.deleteFeedbacks(input.id);

    return new StepResponse({ success: true }, original);
  },
  async (original: any, { container }) => {
    const service: FeedbackService = container.resolve(FEEDBACK_MODULE);
    await service.createFeedbacks(original);
  }
);

export type DeleteFeedbackWorkflowInput = DeleteFeedbackStepInput;

export const deleteFeedbackWorkflow = createWorkflow(
  "delete-feedback",
  (input: DeleteFeedbackWorkflowInput) => {
    const result = deleteFeedbackStep(input);
    return new WorkflowResponse(result);
  }
);
