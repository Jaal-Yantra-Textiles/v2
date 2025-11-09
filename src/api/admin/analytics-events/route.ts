import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { AnalyticsEventCreate, AnalyticsEventQuery } from "./validators";
import { createAnalyticsEventWorkflow } from "../../../workflows/analytics/create-analytics-event";
import { listAnalyticsEventWorkflow } from "../../../workflows/analytics/list-analytics-event";

export const GET = async (
  req: MedusaRequest<AnalyticsEventQuery>,
  res: MedusaResponse
) => {
  const queryParams = req.validatedQuery || {};
  
  // Build filters object with only defined values
  const filters: Record<string, any> = {};
  if (queryParams.website_id) filters.website_id = queryParams.website_id;
  if (queryParams.event_type) filters.event_type = queryParams.event_type;
  if (queryParams.visitor_id) filters.visitor_id = queryParams.visitor_id;
  if (queryParams.session_id) filters.session_id = queryParams.session_id;
  
  const { result } = await listAnalyticsEventWorkflow(req.scope).run({
    input: {
      filters,
      config: {
        skip: queryParams.offset,
        take: queryParams.limit,
        select: queryParams.fields as string[] | undefined,
      },
    },
  });
  
  res.status(200).json({ analyticsEvents: result[0], count: result[1] });
};

export const POST = async (
  req: MedusaRequest<AnalyticsEventCreate>,
  res: MedusaResponse
) => {
  const { result } = await createAnalyticsEventWorkflow(req.scope).run({
    input: req.validatedBody,
  });
  
  res.status(201).json({ analyticsEvent: result });
};
