import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { ANALYTICS_MODULE } from "../../../modules/analytics";
import {
  resolveSessionListParams,
  SESSION_SELECT,
  type SessionListParamsInput,
} from "./sessions-list-lib";

/**
 * Get Website Sessions (#569 S7a)
 *
 * Paginated list of a website's analytics sessions, ordered by a whitelisted
 * column. There is NO website→analytics_session module link, so sessions are
 * fetched directly from the analytics module (`custom_analytics`). The fetch is
 * best-effort: any error returns an empty page rather than throwing, mirroring
 * the other session-backed report workflows (S1/S2).
 */
export type GetWebsiteSessionsInput = SessionListParamsInput & {
  website_id: string;
  start_date?: Date;
  end_date?: Date;
};

export type WebsiteSessionsResult = {
  sessions: any[];
  count: number;
  limit: number;
  offset: number;
};

export const getWebsiteSessionsStep = createStep(
  "get-website-sessions-step",
  async (input: GetWebsiteSessionsInput, { container }) => {
    const { take, skip, order } = resolveSessionListParams(input);

    const filters: Record<string, any> = { website_id: input.website_id };
    if (input.start_date || input.end_date) {
      filters.started_at = {};
      if (input.start_date) filters.started_at.$gte = input.start_date;
      if (input.end_date) filters.started_at.$lte = input.end_date;
    }

    let sessions: any[] = [];
    let count = 0;
    try {
      const analyticsService = container.resolve(ANALYTICS_MODULE) as any;
      const [rows, total] =
        await analyticsService.listAndCountAnalyticsSessions(filters as any, {
          select: SESSION_SELECT as unknown as string[],
          take,
          skip,
          order,
        } as any);
      sessions = rows ?? [];
      count = total ?? 0;
    } catch (e) {
      // best-effort — never throw the overview/report surface
      sessions = [];
      count = 0;
    }

    return new StepResponse<WebsiteSessionsResult>({
      sessions,
      count,
      limit: take,
      offset: skip,
    });
  }
);

export const getWebsiteSessionsWorkflow = createWorkflow(
  "get-website-sessions",
  (input: GetWebsiteSessionsInput) => {
    const result = getWebsiteSessionsStep(input);
    return new WorkflowResponse(result);
  }
);
