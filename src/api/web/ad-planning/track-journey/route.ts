/**
 * Web Journey Tracking API
 * Public endpoint for tracking customer journey events from the client-side
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { z } from "zod";
import { AD_PLANNING_MODULE } from "../../../../modules/ad-planning";

// Validator for journey tracking request
export const TrackJourneySchema = z.object({
  website_id: z.string(),
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
    "custom"
  ]).default("page_view"),
  event_name: z.string().optional(),
  event_data: z.record(z.any()).optional().nullable(),
  channel: z.enum([
    "web",
    "social",
    "email",
    "sms",
    "phone",
    "in_person",
    "ad"
  ]).default("web"),
  stage: z.enum([
    "awareness",
    "interest",
    "consideration",
    "intent",
    "conversion",
    "retention",
    "advocacy"
  ]).optional(),
  visitor_id: z.string(),
  person_id: z.string().optional().nullable(),
  page_url: z.string().optional(),
  utm_source: z.string().optional(),
  utm_campaign: z.string().optional(),
  ad_campaign_id: z.string().optional().nullable(),
  source_type: z.string().optional().nullable(),
  source_id: z.string().optional().nullable(),
  metadata: z.record(z.any()).optional().nullable(),
});

export type TrackJourneyRequest = z.infer<typeof TrackJourneySchema>;

/**
 * Infer funnel stage from event type
 */
function inferStage(eventType: string): "awareness" | "interest" | "consideration" | "intent" | "conversion" | "retention" | "advocacy" {
  switch (eventType) {
    case "page_view":
    case "ad_click":
      return "awareness";
    case "social_engage":
    case "email_open":
      return "interest";
    case "form_submit":
    case "lead_capture":
    case "email_click":
      return "consideration";
    case "feedback":
    case "support_ticket":
      return "intent";
    case "purchase":
      return "conversion";
    default:
      return "awareness";
  }
}

/**
 * Track a customer journey event from the client
 * @route POST /web/ad-planning/track-journey
 */
export const POST = async (
  req: MedusaRequest<TrackJourneyRequest>,
  res: MedusaResponse
) => {
  try {
    // Validate request body
    const validatedData = TrackJourneySchema.parse(req.body);

    // Get the ad planning service
    const adPlanningService = req.scope.resolve(AD_PLANNING_MODULE);

    // Infer stage if not provided
    const stage = validatedData.stage || inferStage(validatedData.event_type);

    // Create journey record
    const [journey] = await adPlanningService.createCustomerJourneys([{
      website_id: validatedData.website_id,
      event_type: validatedData.event_type,
      event_name: validatedData.event_name || null,
      event_data: validatedData.event_data || null,
      channel: validatedData.channel,
      stage,
      visitor_id: validatedData.visitor_id,
      person_id: validatedData.person_id || null,
      page_url: validatedData.page_url || null,
      utm_source: validatedData.utm_source || null,
      utm_campaign: validatedData.utm_campaign || null,
      ad_campaign_id: validatedData.ad_campaign_id || null,
      source_type: validatedData.source_type || null,
      source_id: validatedData.source_id || null,
      occurred_at: new Date(),
      metadata: validatedData.metadata || null,
    }]);

    // Return success (keep response minimal for performance)
    res.status(200).json({
      success: true,
      message: "Journey event tracked",
      journey_id: journey.id,
    });
  } catch (error) {
    console.error("Journey tracking error:", error);
    // Don't expose errors to client for security
    res.status(200).json({
      success: true,
      message: "Journey event received",
    });
  }
};

// Public endpoint - no authentication required
export const AUTHENTICATE = false;
