import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { ANALYTICS_MODULE } from "../../modules/analytics";

export type UpdateAnalyticsEventStepInput = {
  id: string;
  website_id?: string;
  event_type?: "pageview" | "custom_event";
  event_name?: string | null;
  pathname?: string;
  referrer?: string | null;
  referrer_source?: string | null;
  visitor_id?: string;
  session_id?: string;
  user_agent?: string | null;
  browser?: string | null;
  os?: string | null;
  device_type?: "desktop" | "mobile" | "tablet" | "unknown";
  country?: string | null;
  metadata?: Record<string, any> | null;
  timestamp?: Date;
};

export const updateAnalyticsEventStep = createStep(
  "update-analytics-event-step",
  async (input: UpdateAnalyticsEventStepInput, { container }) => {
    const service = container.resolve(ANALYTICS_MODULE) as any;
    const { id, ...updateData } = input;

    const original = await service.retrieveAnalyticsEvent(id);

    const updated = await service.updateAnalyticsEvents({ id, ...updateData });

    return new StepResponse(updated, { id, originalData: original });
  },
  async (compensationData: { id: string; originalData: any }, { container }) => {
    const service = container.resolve(ANALYTICS_MODULE) as any;
    await service.updateAnalyticsEvents({ id: compensationData.id, ...compensationData.originalData });
  }
);

export type UpdateAnalyticsEventWorkflowInput = UpdateAnalyticsEventStepInput;

export const updateAnalyticsEventWorkflow = createWorkflow(
  "update-analytics-event",
  (input: UpdateAnalyticsEventWorkflowInput) => {
    const result = updateAnalyticsEventStep(input);
    return new WorkflowResponse(result);
  }
);
