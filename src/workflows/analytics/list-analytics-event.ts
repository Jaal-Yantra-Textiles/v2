import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { ANALYTICS_MODULE } from "../../modules/analytics";

export type ListAnalyticsEventStepInput = {
  filters?: Record<string, any>;
  config?: {
    skip?: number;
    take?: number;
    select?: string[];
    relations?: string[];
  };
};

export const listAnalyticsEventStep = createStep(
  "list-analytics-event-step",
  async (input: ListAnalyticsEventStepInput, { container }) => {
    const service = container.resolve(ANALYTICS_MODULE) as any;
    
    // Debug logging
    console.log('List Analytics Events - Filters:', JSON.stringify(input.filters));
    console.log('List Analytics Events - Config:', JSON.stringify(input.config));
    
    const results = await service.listAndCountAnalyticsEvents(
      input.filters || {},
      input.config
    );
    
    console.log('List Analytics Events - Results count:', results[1]);
    console.log('List Analytics Events - First result:', results[0][0]);
    
    return new StepResponse(results);
  }
);

export type ListAnalyticsEventWorkflowInput = ListAnalyticsEventStepInput;

export const listAnalyticsEventWorkflow = createWorkflow(
  "list-analytics-event",
  (input: ListAnalyticsEventWorkflowInput) => {
    const results = listAnalyticsEventStep(input);
    return new WorkflowResponse(results);
  }
);
