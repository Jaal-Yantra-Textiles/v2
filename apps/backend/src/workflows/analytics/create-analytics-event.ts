import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { ANALYTICS_MODULE } from "../../modules/analytics";
import AnalyticsService from "../../modules/analytics/service";

export type CreateAnalyticsEventStepInput = {
  website_id: string;
  event_type?: "pageview" | "custom_event";
  event_name?: string | null;
  pathname: string;
  referrer?: string | null;
  referrer_source?: string | null;
  visitor_id: string;
  session_id: string;
  user_agent?: string | null;
  browser?: string | null;
  os?: string | null;
  device_type?: "desktop" | "mobile" | "tablet" | "unknown";
  country?: string | null;
  metadata?: Record<string, any> | null;
  timestamp: Date;
};

export const createAnalyticsEventStep = createStep(
  "create-analytics-event-step",
  async (input: CreateAnalyticsEventStepInput, { container }) => {
    const service: AnalyticsService = container.resolve(ANALYTICS_MODULE);
    const created = await service.createAnalyticsEvents(input);
    return new StepResponse(created, created.id);
  },
  async (id: string, { container }) => {
    const service = container.resolve(ANALYTICS_MODULE) as any;
    await service.softDeleteAnalyticsEvents(id);
  }
);

export type CreateAnalyticsEventWorkflowInput = CreateAnalyticsEventStepInput;

export const createAnalyticsEventWorkflow = createWorkflow(
  "create-analytics-event",
  (input: CreateAnalyticsEventWorkflowInput) => {
    const result = createAnalyticsEventStep(input);
    return new WorkflowResponse(result);
  }
);
