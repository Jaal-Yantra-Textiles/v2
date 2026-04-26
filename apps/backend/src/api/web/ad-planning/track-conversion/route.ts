/**
 * Web Conversion Tracking API
 * Public endpoint for tracking conversions from the client-side
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { z } from "@medusajs/framework/zod";
import { AD_PLANNING_MODULE } from "../../../../modules/ad-planning";

// Validator for conversion tracking request
export const TrackConversionSchema = z.object({
  website_id: z.string(),
  conversion_type: z.enum([
    "lead_form_submission",
    "add_to_cart",
    "begin_checkout",
    "purchase",
    "page_engagement",
    "scroll_depth",
    "time_on_site",
    "custom"
  ]).default("custom"),
  conversion_name: z.string().optional(),
  pathname: z.string(),
  visitor_id: z.string(),
  session_id: z.string().optional(),
  conversion_value: z.number().optional().nullable(),
  currency: z.string().default("INR"),
  order_id: z.string().optional().nullable(),
  utm_source: z.string().optional(),
  utm_medium: z.string().optional(),
  utm_campaign: z.string().optional(),
  utm_term: z.string().optional(),
  utm_content: z.string().optional(),
  metadata: z.record(z.any()).optional().nullable(),
});

export type TrackConversionRequest = z.infer<typeof TrackConversionSchema>;

/**
 * Track a conversion event from the client
 * @route POST /web/ad-planning/track-conversion
 */
export const POST = async (
  req: MedusaRequest<TrackConversionRequest>,
  res: MedusaResponse
) => {
  try {
    // Validate request body
    const validatedData = TrackConversionSchema.parse(req.body);

    // Get the ad planning service
    const adPlanningService = req.scope.resolve(AD_PLANNING_MODULE);

    // Create conversion record
    const [conversion] = await adPlanningService.createConversions([{
      website_id: validatedData.website_id,
      conversion_type: validatedData.conversion_type,
      conversion_name: validatedData.conversion_name || null,
      visitor_id: validatedData.visitor_id,
      session_id: validatedData.session_id || null,
      conversion_value: validatedData.conversion_value || null,
      currency: validatedData.currency,
      order_id: validatedData.order_id || null,
      utm_source: validatedData.utm_source || null,
      utm_medium: validatedData.utm_medium || null,
      utm_campaign: validatedData.utm_campaign || null,
      utm_term: validatedData.utm_term || null,
      utm_content: validatedData.utm_content || null,
      platform: validatedData.utm_source?.toLowerCase().includes("facebook") ||
                validatedData.utm_source?.toLowerCase().includes("instagram") ||
                validatedData.utm_source?.toLowerCase().includes("meta")
        ? "meta"
        : validatedData.utm_source?.toLowerCase().includes("google")
        ? "google"
        : validatedData.utm_source
        ? "generic"
        : "direct",
      attribution_model: "last_click",
      converted_at: new Date(),
      metadata: validatedData.metadata || null,
    }]);

    // Return success (keep response minimal for performance)
    res.status(200).json({
      success: true,
      message: "Conversion tracked",
      conversion_id: conversion.id,
    });
  } catch (error) {
    console.error("Conversion tracking error:", error);
    // Don't expose errors to client for security
    res.status(200).json({
      success: true,
      message: "Conversion received",
    });
  }
};

// Public endpoint - no authentication required
export const AUTHENTICATE = false;
