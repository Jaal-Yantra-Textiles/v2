import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { FEEDBACK_MODULE } from "../../modules/feedback";
import FeedbackService from "../../modules/feedback/service";

export type UpdateFeedbackStepInput = {
  id: string;
  // TODO: Define optional properties for updating a Feedback from your model
  // Example: name?: string;
};

export const updateFeedbackStep = createStep(
  "update-feedback-step",
  async (input: UpdateFeedbackStepInput, { container }) => {
    const service: FeedbackService = container.resolve(FEEDBACK_MODULE);
    const { id, ...updateData } = input;

    const original = await service.retrieveFeedback(id);

    const updated = await service.updateFeedbacks({ id, ...updateData });

    return new StepResponse(updated, { id, originalData: original });
  },
  async (compensationData: { id: string; originalData: any }, { container }) => {
    const service: FeedbackService = container.resolve(FEEDBACK_MODULE);
    await service.updateFeedbacks({ id: compensationData.id, ...compensationData.originalData });
  }
);

export type UpdateFeedbackWorkflowInput = UpdateFeedbackStepInput;

export const updateFeedbackWorkflow = createWorkflow(
  "update-feedback",
  (input: UpdateFeedbackWorkflowInput) => {
    const result = updateFeedbackStep(input);
    return new WorkflowResponse(result);
  }
);
