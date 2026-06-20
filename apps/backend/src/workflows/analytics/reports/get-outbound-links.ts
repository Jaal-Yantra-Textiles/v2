import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk";
import { ANALYTICS_MODULE } from "../../../modules/analytics";
import {
  computeOutboundLinks,
  DEFAULT_OUTBOUND_LINKS_LIMIT,
  type OutboundLinkEventRow,
  type OutboundLinksResult,
} from "./outbound-links-lib";

/**
 * Get Outbound Links (#569 S5a)
 *
 * Ranked aggregation of a website's `link_out` custom events (external link
 * clicks) by their destination URL (`metadata.href`), over an optional date
 * range. The client (`apps/analytics/src/analytics.js`) emits these events.
 *
 * Events are resolved directly off the custom_analytics service (mirrors
 * get-analytics-breakdown's event fetch), scoped to `event_name = "link_out"`.
 */
export type GetOutboundLinksInput = {
  website_id: string;
  start_date?: Date;
  end_date?: Date;
  limit?: number;
};

export const getOutboundLinksStep = createStep(
  "get-outbound-links-step",
  async (input: GetOutboundLinksInput, { container }) => {
    const analyticsService = container.resolve(ANALYTICS_MODULE) as any;

    const filters: any = {
      website_id: input.website_id,
      event_name: "link_out",
    };
    if (input.start_date || input.end_date) {
      filters.timestamp = {};
      if (input.start_date) filters.timestamp.$gte = input.start_date;
      if (input.end_date) filters.timestamp.$lte = input.end_date;
    }

    const [events] = await analyticsService.listAndCountAnalyticsEvents(filters, {
      select: ["visitor_id", "metadata"],
    });

    const result: OutboundLinksResult = computeOutboundLinks(
      events as OutboundLinkEventRow[],
      input.limit ?? DEFAULT_OUTBOUND_LINKS_LIMIT
    );

    return new StepResponse(result);
  }
);

export const getOutboundLinksWorkflow = createWorkflow(
  "get-outbound-links",
  (input: GetOutboundLinksInput) => {
    const result = getOutboundLinksStep(input);
    return new WorkflowResponse(result);
  }
);
