/**
 * Admin Customer Journeys API
 * Track and analyze customer journeys
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { z } from "zod";
import { AD_PLANNING_MODULE } from "../../../../modules/ad-planning";

const ListJourneysQuerySchema = z.object({
  person_id: z.string().optional(),
  website_id: z.string().optional(),
  event_type: z.string().optional(),
  stage: z.enum(["awareness", "interest", "consideration", "intent", "conversion", "retention", "advocacy"]).optional(),
  from_date: z.string().optional(),
  to_date: z.string().optional(),
  limit: z.coerce.number().default(100),
  offset: z.coerce.number().default(0),
});

const CreateJourneyEventSchema = z.object({
  person_id: z.string(),
  website_id: z.string().optional(),
  event_type: z.enum([
    "form_submit",
    "feedback",
    "purchase",
    "page_view",
    "social_engage",
    "lead_capture",
    "email_open",
    "email_click",
    "ad_click",
    "support_ticket",
    "custom",
  ]),
  stage: z.enum(["awareness", "interest", "consideration", "intent", "conversion", "retention", "advocacy"]).optional(),
  channel: z.enum(["web", "social", "email", "sms", "phone", "in_person", "ad"]).optional(),
  event_data: z.record(z.any()).optional(),
});

/**
 * List journey events
 * @route GET /admin/ad-planning/journeys
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const params = ListJourneysQuerySchema.parse(req.query);
  const adPlanningService = req.scope.resolve(AD_PLANNING_MODULE);

  const filters: Record<string, any> = {};
  if (params.person_id) filters.person_id = params.person_id;
  if (params.website_id) filters.website_id = params.website_id;
  if (params.event_type) filters.event_type = params.event_type;
  if (params.stage) filters.stage = params.stage;

  if (params.from_date || params.to_date) {
    filters.occurred_at = {};
    if (params.from_date) filters.occurred_at.$gte = new Date(params.from_date);
    if (params.to_date) filters.occurred_at.$lte = new Date(params.to_date);
  }

  const journeys = await adPlanningService.listCustomerJourneys(filters, {
    skip: params.offset,
    take: params.limit,
    order: { occurred_at: "DESC" },
  });

  res.json({
    journeys,
    count: journeys.length,
    offset: params.offset,
    limit: params.limit,
  });
};

/**
 * Create journey event
 * @route POST /admin/ad-planning/journeys
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const data = CreateJourneyEventSchema.parse(req.body);
  const adPlanningService = req.scope.resolve(AD_PLANNING_MODULE);

  // Auto-determine stage if not provided
  let stage = data.stage;
  if (!stage) {
    const stageMap: Record<string, string> = {
      page_view: "awareness",
      ad_click: "awareness",
      social_engage: "interest",
      form_submit: "consideration",
      email_open: "consideration",
      email_click: "intent",
      lead_capture: "intent",
      purchase: "conversion",
      feedback: "retention",
      support_ticket: "retention",
    };
    stage = (stageMap[data.event_type] || "awareness") as any;
  }

  const [journey] = await adPlanningService.createCustomerJourneys([
    {
      ...data,
      stage,
      occurred_at: new Date(),
    },
  ]);

  res.status(201).json({ journey });
};
