import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { FEEDBACK_MODULE } from "../../modules/feedback";
import FeedbackService from "../../modules/feedback/service";

export type ListFeedbackStepInput = {
  filters?: Record<string, any>;
  config?: {
    skip?: number;
    take?: number;
    select?: string[];
    relations?: string[];
  };
};

export const listFeedbackStep = createStep(
  "list-feedback-step",
  async (input: ListFeedbackStepInput, { container }) => {
    const service: FeedbackService = container.resolve(FEEDBACK_MODULE);
    const results = await service.listAndCountFeedbacks(
      input.filters,
      input.config
    );
    return new StepResponse(results);
  }
);

export type ListFeedbackWorkflowInput = ListFeedbackStepInput;

export const listFeedbackWorkflow = createWorkflow(
  "list-feedback",
  (input: ListFeedbackWorkflowInput) => {
    const results = listFeedbackStep(input);
    return new WorkflowResponse(results);
  }
);
