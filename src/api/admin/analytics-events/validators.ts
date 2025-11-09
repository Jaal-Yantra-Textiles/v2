import { z } from "zod";

// Create schema for AnalyticsEvent
export const AnalyticsEventCreateSchema = z.object({
  website_id: z.string(),
  event_type: z.enum(["pageview", "custom_event"]).default("pageview"),
  event_name: z.string().nullable().optional(),
  pathname: z.string(),
  referrer: z.string().nullable().optional(),
  referrer_source: z.string().nullable().optional(),
  visitor_id: z.string(),
  session_id: z.string(),
  user_agent: z.string().nullable().optional(),
  browser: z.string().nullable().optional(),
  os: z.string().nullable().optional(),
  device_type: z.enum(["desktop", "mobile", "tablet", "unknown"]).default("unknown"),
  country: z.string().nullable().optional(),
  metadata: z.record(z.any()).nullable().optional(),
  timestamp: z.coerce.date(),
});

export type AnalyticsEventCreate = z.infer<typeof AnalyticsEventCreateSchema>;

// Update schema - all fields optional except id
export const AnalyticsEventUpdateSchema = z.object({
  website_id: z.string().optional(),
  event_type: z.enum(["pageview", "custom_event"]).optional(),
  event_name: z.string().nullable().optional(),
  pathname: z.string().optional(),
  referrer: z.string().nullable().optional(),
  referrer_source: z.string().nullable().optional(),
  visitor_id: z.string().optional(),
  session_id: z.string().optional(),
  user_agent: z.string().nullable().optional(),
  browser: z.string().nullable().optional(),
  os: z.string().nullable().optional(),
  device_type: z.enum(["desktop", "mobile", "tablet", "unknown"]).optional(),
  country: z.string().nullable().optional(),
  metadata: z.record(z.any()).nullable().optional(),
  timestamp: z.coerce.date().optional(),
});

export type AnalyticsEventUpdate = z.infer<typeof AnalyticsEventUpdateSchema>;

// Query params schema
export const AnalyticsEventQuerySchema = z.object({
  limit: z.preprocess(
    (val) => (typeof val === "string" ? parseInt(val, 10) : val),
    z.number().min(1).max(100).default(20)
  ),
  offset: z.preprocess(
    (val) => (typeof val === "string" ? parseInt(val, 10) : val),
    z.number().min(0).default(0)
  ),
  fields: z.preprocess(
    (val) => (typeof val === "string" ? val.split(",") : val),
    z.array(z.string()).optional()
  ),
  website_id: z.string().optional(),
  event_type: z.enum(["pageview", "custom_event"]).optional(),
  visitor_id: z.string().optional(),
  session_id: z.string().optional(),
});

export type AnalyticsEventQuery = z.infer<typeof AnalyticsEventQuerySchema>;
