import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { z } from "zod";
import { trackAnalyticsEventWorkflow } from "../../../../workflows/analytics/track-analytics-event";

// Validator for tracking request
export const TrackEventSchema = z.object({
  website_id: z.string(),
  event_type: z.enum(["pageview", "custom_event"]).default("pageview"),
  event_name: z.string().optional(),
  pathname: z.string(),
  referrer: z.string().optional(),
  visitor_id: z.string(),
  session_id: z.string(),
  metadata: z.record(z.any()).optional(),
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

    // Run tracking workflow
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
