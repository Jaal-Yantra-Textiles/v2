/**
 * @file Web Analytics API route for tracking events
 * @description Provides endpoints for tracking pageviews and custom events in the JYT Commerce platform
 * @module API/Web/Analytics
 */

/**
 * @typedef {Object} TrackEventRequest
 * @property {string} website_id - The ID of the website where the event occurred
 * @property {string} event_type - Type of event being tracked (pageview or custom_event)
 * @property {string} [event_name] - Name of the custom event (required if event_type is custom_event)
 * @property {string} pathname - The page path where the event occurred (e.g., /about)
 * @property {string} [referrer] - The referrer URL
 * @property {string} visitor_id - Hashed visitor identifier (generated client-side)
 * @property {string} session_id - Session identifier (generated client-side)
 * @property {string} [query_string] - Query string from the URL
 * @property {boolean} [is_404=false] - Whether this is a 404 page
 * @property {string} [utm_source] - UTM source parameter
 * @property {string} [utm_medium] - UTM medium parameter
 * @property {string} [utm_campaign] - UTM campaign parameter
 * @property {string} [utm_term] - UTM term parameter
 * @property {string} [utm_content] - UTM content parameter
 * @property {Object} [metadata] - Additional metadata for the event
 */

/**
 * @typedef {Object} TrackEventResponse
 * @property {boolean} success - Whether the event was tracked successfully
 * @property {string} message - Status message about the tracking
 */

/**
 * Track a pageview or custom event for analytics
 * @route POST /web/analytics/track
 * @group Analytics - Operations related to analytics tracking
 * @param {TrackEventRequest} request.body.required - Event data to track
 * @returns {TrackEventResponse} 200 - Event tracked successfully
 * @throws {MedusaError} 400 - Invalid request data
 *
 * @example request
 * POST /web/analytics/track
 * {
 *   "website_id": "web_123456789",
 *   "event_type": "pageview",
 *   "pathname": "/products/shoes",
 *   "visitor_id": "vis_abc123def456",
 *   "session_id": "ses_789ghi012jkl",
 *   "referrer": "https://google.com",
 *   "utm_source": "google",
 *   "utm_medium": "cpc",
 *   "metadata": {
 *     "device_type": "mobile",
 *     "screen_resolution": "1920x1080"
 *   }
 * }
 *
 * @example response 200
 * {
 *   "success": true,
 *   "message": "Event tracked"
 * }
 *
 * @example request - Custom Event
 * POST /web/analytics/track
 * {
 *   "website_id": "web_123456789",
 *   "event_type": "custom_event",
 *   "event_name": "add_to_cart",
 *   "pathname": "/products/shoes",
 *   "visitor_id": "vis_abc123def456",
 *   "session_id": "ses_789ghi012jkl",
 *   "metadata": {
 *     "product_id": "prod_123",
 *     "quantity": 1
 *   }
 * }
 */
import { randomUUID } from "crypto";
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { z } from "@medusajs/framework/zod";
import { trackAnalyticsEventWorkflow } from "../../../../workflows/analytics/track-analytics-event";
import {
  getIngestRedis,
  isBatchIngestEnabled,
  isHeartbeatEvent,
  pushBufferedEvent,
} from "../../../../modules/analytics/ingest-buffer";

// Validator for tracking request
export const TrackEventSchema = z.object({
  website_id: z.string(),
  event_type: z.enum(["pageview", "custom_event"]).default("pageview"),
  event_name: z.string().optional(),
  pathname: z.string(),
  referrer: z.string().optional(),
  visitor_id: z.string(),
  session_id: z.string(),
  query_string: z.string().optional(),
  is_404: z.boolean().optional().default(false),
  utm_source: z.string().optional(),
  utm_medium: z.string().optional(),
  utm_campaign: z.string().optional(),
  utm_term: z.string().optional(),
  utm_content: z.string().optional(),
  // Browser-side country capture (#559 slice 6): the client sends its IANA time
  // zone + locale so the backend can derive country without an edge GeoIP. An
  // explicit `country` (rare; set by a proxy/edge) still wins when present.
  timezone: z.string().optional(),
  locale: z.string().optional(),
  country: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export type TrackEventRequest = z.infer<typeof TrackEventSchema>;

/**
 * @oas [post] /web/analytics/track
 * summary: "Track Analytics Event"
 * description: "Track a pageview or custom event for analytics. This endpoint is public and does not require authentication."
 * x-authenticated: false
 * requestBody:
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required:
 *           - website_id
 *           - pathname
 *           - visitor_id
 *           - session_id
 *         properties:
 *           website_id:
 *             type: string
 *             description: The ID of the website
 *           event_type:
 *             type: string
 *             enum: [pageview, custom_event]
 *             default: pageview
 *           event_name:
 *             type: string
 *             description: Name of the custom event (required if event_type is custom_event)
 *           pathname:
 *             type: string
 *             description: The page path (e.g., /about)
 *           referrer:
 *             type: string
 *             description: The referrer URL
 *           visitor_id:
 *             type: string
 *             description: Hashed visitor identifier (generated client-side)
 *           session_id:
 *             type: string
 *             description: Session identifier (generated client-side)
 *           metadata:
 *             type: object
 *             description: Additional metadata for the event
 * responses:
 *   "200":
 *     description: Event tracked successfully
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             success:
 *               type: boolean
 *             message:
 *               type: string
 *   "400":
 *     description: Invalid request
 */
export const POST = async (
  req: MedusaRequest<TrackEventRequest>,
  res: MedusaResponse
) => {
  try {
    // Validate request body
    const validatedData = TrackEventSchema.parse(req.body);

    // Extract user agent and IP for additional context
    const userAgent = req.headers["user-agent"] || "";
    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "";

    // Hybrid batching (#559): when ANALYTICS_BATCH_INGEST is on, the bulk firehose
    // (pageviews / custom events) is LPUSHed to Redis and persisted by the
    // drain-analytics-buffer job — the request returns without a synchronous DB
    // write. Heartbeats ALWAYS write through so the live-visitor count stays
    // real-time. We capture the visitor's real UA + IP here, so the async path
    // keeps full device/geo fidelity.
    if (
      isBatchIngestEnabled() &&
      !isHeartbeatEvent(validatedData.event_type, validatedData.event_name)
    ) {
      try {
        await pushBufferedEvent(getIngestRedis(), {
          event_id: randomUUID(),
          website_id: validatedData.website_id,
          event_type: validatedData.event_type,
          event_name: validatedData.event_name,
          pathname: validatedData.pathname,
          referrer: validatedData.referrer,
          visitor_id: validatedData.visitor_id,
          session_id: validatedData.session_id,
          query_string: validatedData.query_string,
          is_404: validatedData.is_404,
          utm_source: validatedData.utm_source,
          utm_medium: validatedData.utm_medium,
          utm_campaign: validatedData.utm_campaign,
          utm_term: validatedData.utm_term,
          utm_content: validatedData.utm_content,
          timezone: validatedData.timezone,
          locale: validatedData.locale,
          country: validatedData.country,
          metadata: validatedData.metadata,
          user_agent: userAgent as string,
          ip_address: ip as string,
          timestamp: new Date().toISOString(),
        });
        return res.status(200).json({ success: true, message: "Event queued" });
      } catch (bufferErr) {
        // Buffer unavailable (e.g. Redis down) → fall through to the synchronous
        // write so we never silently drop an event.
        console.error(
          "Analytics buffer push failed, writing through synchronously:",
          bufferErr
        );
      }
    }

    // Run tracking workflow (synchronous path: flag off, heartbeat, or buffer fallback)
    await trackAnalyticsEventWorkflow(req.scope).run({
      input: {
        ...validatedData,
        user_agent: userAgent,
        ip_address: ip as string,
        timestamp: new Date(),
      },
    });

    // Return success (keep response minimal for performance)
    res.status(200).json({
      success: true,
      message: "Event tracked",
    });
  } catch (error) {
    console.error("Analytics tracking error:", error);
    // Don't expose errors to client for security
    res.status(200).json({
      success: true,
      message: "Event received",
    });
  }
};

// CORS configuration for public endpoint
export const AUTHENTICATE = false;
