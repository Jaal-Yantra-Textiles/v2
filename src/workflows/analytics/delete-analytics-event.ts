import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { ANALYTICS_MODULE } from "../../modules/analytics";
import AnalyticsService from "../../modules/analytics/service";

export type DeleteAnalyticsEventStepInput = {
  id: string;
};

export const deleteAnalyticsEventStep = createStep(
  "delete-analytics-event-step",
  async (input: DeleteAnalyticsEventStepInput, { container }) => {
    const service: AnalyticsService = container.resolve(ANALYTICS_MODULE) as any;
    const original = await service.retrieveAnalyticsEvent(input.id);

    await service.deleteAnalyticsEvents(input.id);

    return new StepResponse({ success: true }, original);
  },
  async (original: any, { container }) => {
    const service = container.resolve(ANALYTICS_MODULE) as any;
    await service.createAnalyticsEvents(original);
  }
);

export type DeleteAnalyticsEventWorkflowInput = DeleteAnalyticsEventStepInput;

export const deleteAnalyticsEventWorkflow = createWorkflow(
  "delete-analytics-event",
  (input: DeleteAnalyticsEventWorkflowInput) => {
    const result = deleteAnalyticsEventStep(input);
    return new WorkflowResponse(result);
  }
);
