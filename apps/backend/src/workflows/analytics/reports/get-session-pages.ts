import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk";
import { ANALYTICS_MODULE } from "../../../modules/analytics";
import {
  computeSessionPageBreakdown,
  DEFAULT_SESSION_PAGE_LIMIT,
  SESSION_PAGE_DIMENSIONS,
  type SessionPageBreakdownResult,
  type SessionPageDimension,
  type SessionPageRow,
} from "./session-pages-lib";

/**
 * Get Session Pages Breakdown (#569 S2)
 *
 * Ranked aggregation of a website's analytics sessions by their entry and/or
 * exit page, over an optional date range. Complements the events breakdown
 * (getAnalyticsBreakdownWorkflow) which groups raw events; here we group
 * sessions so the admin can see "top landing pages" and "top exit pages".
 *
 * There is NO website→analytics_session module link, so sessions are resolved
 * directly off the custom_analytics service (mirrors get-website-analytics-
 * overview's S1 session fetch). The fetch is best-effort: a missing
 * service/method or query error degrades to empty (zeroed) breakdowns rather
 * than throwing.
 */
export type GetSessionPagesInput = {
  website_id: string;
  start_date?: Date;
  end_date?: Date;
  /** Which page dimensions to compute. Defaults to both entry + exit. */
  dimensions?: SessionPageDimension[];
  limit?: number;
};

export type GetSessionPagesResult = {
  /** Present only for requested dimensions. */
  entry_page?: SessionPageBreakdownResult;
  exit_page?: SessionPageBreakdownResult;
};

export const getSessionPagesStep = createStep(
  "get-session-pages-step",
  async (input: GetSessionPagesInput, { container }) => {
    const dimensions =
      input.dimensions && input.dimensions.length > 0
        ? input.dimensions
        : SESSION_PAGE_DIMENSIONS;
    const limit = input.limit ?? DEFAULT_SESSION_PAGE_LIMIT;

    let sessions: SessionPageRow[] = [];
    try {
      const analyticsService: any = container.resolve(ANALYTICS_MODULE);
      if (analyticsService?.listAnalyticsSessions) {
        const filters: any = { website_id: input.website_id };
        if (input.start_date || input.end_date) {
          filters.started_at = {};
          if (input.start_date) filters.started_at.$gte = input.start_date;
          if (input.end_date) filters.started_at.$lte = input.end_date;
        }
        sessions = await analyticsService.listAnalyticsSessions(filters, {
          select: ["visitor_id", "entry_page", "exit_page"],
          take: 100000,
        });
      }
    } catch (e) {
      // keep empty -> zeroed breakdowns
      sessions = [];
    }

    const result: GetSessionPagesResult = {};
    for (const dimension of dimensions) {
      result[dimension] = computeSessionPageBreakdown(sessions, dimension, limit);
    }

    return new StepResponse(result);
  }
);

export const getSessionPagesWorkflow = createWorkflow(
  "get-session-pages",
  (input: GetSessionPagesInput) => {
    const result = getSessionPagesStep(input);
    return new WorkflowResponse(result);
  }
);
