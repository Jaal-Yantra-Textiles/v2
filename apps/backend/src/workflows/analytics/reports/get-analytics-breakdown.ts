import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk";
import { ANALYTICS_MODULE } from "../../../modules/analytics";
import {
  applyEventFilters,
  computeBreakdown,
  DEFAULT_BREAKDOWN_LIMIT,
  type BreakdownDimension,
  type BreakdownResult,
} from "./breakdown-lib";

/**
 * Get Analytics Breakdown (#559 slice 3)
 *
 * Granular single-dimension breakdown of a website's events, with composable
 * equality filters and an optional date range. Complements the high-level
 * getAnalyticsStatsWorkflow which returns a fixed set of aggregates.
 */
export type GetAnalyticsBreakdownInput = {
  website_id: string;
  dimension: BreakdownDimension;
  start_date?: Date;
  end_date?: Date;
  /** Composable equality filters keyed by filterable field name. */
  filters?: Record<string, string>;
  limit?: number;
};

export const getAnalyticsBreakdownStep = createStep(
  "get-analytics-breakdown-step",
  async (input: GetAnalyticsBreakdownInput, { container }) => {
    const analyticsService = container.resolve(ANALYTICS_MODULE) as any;

    const filters: any = { website_id: input.website_id };
    if (input.start_date || input.end_date) {
      filters.timestamp = {};
      if (input.start_date) filters.timestamp.$gte = input.start_date;
      if (input.end_date) filters.timestamp.$lte = input.end_date;
    }

    const [events] = await analyticsService.listAndCountAnalyticsEvents(filters, {
      select: [
        "id",
        "visitor_id",
        "session_id",
        "country",
        "device_type",
        "browser",
        "os",
        "referrer_source",
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "utm_term",
        "utm_content",
        "pathname",
        "is_404",
        "event_type",
        "event_name",
      ],
    });

    const filtered = applyEventFilters(events, input.filters);
    const result: BreakdownResult = computeBreakdown(
      filtered,
      input.dimension,
      input.limit ?? DEFAULT_BREAKDOWN_LIMIT
    );

    return new StepResponse(result);
  }
);

export const getAnalyticsBreakdownWorkflow = createWorkflow(
  "get-analytics-breakdown",
  (input: GetAnalyticsBreakdownInput) => {
    const result = getAnalyticsBreakdownStep(input);
    return new WorkflowResponse(result);
  }
);
