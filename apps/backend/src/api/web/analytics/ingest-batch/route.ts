/**
 * @file Batch-ingest API route for analytics events (#344 slice 1).
 * @description
 * Authed bulk endpoint that the Cloudflare edge worker (slice 2) drains its
 * buffer into. Accepts a normalized array of events, authenticates via a
 * shared secret or HMAC signature (`ANALYTICS_INGEST_SECRET`), deduplicates on
 * a client-supplied `event_id` (within-batch AND cross-batch), then reuses the
 * existing `track-analytics-event` workflow per event so session/rollup logic
 * stays identical to the per-request `/web/analytics/track` path.
 *
 * Design note: this is useful even before the worker exists and keeps the edge
 * offload reversible — see apps/docs/notes/525_MODULE_AUDIT_AND_CF_VISITOR_OFFLOAD.md
 * @module API/Web/Analytics
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { z } from "@medusajs/framework/zod";
import { ANALYTICS_MODULE } from "../../../../modules/analytics";
import { trackAnalyticsEventWorkflow } from "../../../../workflows/analytics/track-analytics-event";
import {
  filterAlreadyPersisted,
  normalizeAndDedupeBatch,
  verifyIngestAuth,
  type RawIngestEvent,
} from "./lib";

const MAX_BATCH = 500;

const IngestEventSchema = z
  .object({
    event_id: z.string().optional(),
    website_id: z.string(),
    event_type: z.enum(["pageview", "custom_event"]).optional(),
    event_name: z.string().optional(),
    pathname: z.string(),
    referrer: z.string().optional(),
    visitor_id: z.string(),
    session_id: z.string(),
    query_string: z.string().optional(),
    is_404: z.boolean().optional(),
    utm_source: z.string().optional(),
    utm_medium: z.string().optional(),
    utm_campaign: z.string().optional(),
    utm_term: z.string().optional(),
    utm_content: z.string().optional(),
    country: z.string().optional(),
    metadata: z.record(z.string(), z.any()).optional(),
    timestamp: z.union([z.string(), z.number()]).optional(),
    ts: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

const IngestBatchSchema = z.object({
  events: z.array(IngestEventSchema).max(MAX_BATCH),
});

/**
 * @oas [post] /web/analytics/ingest-batch
 * summary: "Batch-ingest Analytics Events"
 * description: "Authed bulk ingest used by the edge analytics worker. Requires the ANALYTICS_INGEST_SECRET shared secret (header x-analytics-secret) or an HMAC signature (header x-analytics-signature: sha256=<hex of raw body>). Deduplicates on event_id."
 * x-authenticated: false
 * responses:
 *   "200":
 *     description: Batch processed
 *   "401":
 *     description: Missing or invalid ingest credentials
 *   "400":
 *     description: Invalid batch payload
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const secret = process.env.ANALYTICS_INGEST_SECRET;

  const sharedSecretHeader =
    (req.headers["x-analytics-secret"] as string | undefined) || null;
  const signatureHeader =
    (req.headers["x-analytics-signature"] as string | undefined) || null;
  const rawBody =
    (req as any).rawBody != null
      ? (req as any).rawBody.toString()
      : JSON.stringify(req.body ?? {});

  if (
    !verifyIngestAuth({
      secret,
      sharedSecretHeader,
      signatureHeader,
      rawBody,
    })
  ) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  let parsed: z.infer<typeof IngestBatchSchema>;
  try {
    parsed = IngestBatchSchema.parse(req.body);
  } catch (e) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid batch payload" });
  }

  const received = parsed.events.length;
  const { normalized, invalid, deduped } = normalizeAndDedupeBatch(
    parsed.events as RawIngestEvent[],
    new Date()
  );

  // Cross-batch idempotency: skip any event_id we have already persisted.
  let skipped = 0;
  let fresh = normalized;
  const candidateIds = normalized
    .map((e) => e.event_id)
    .filter((id): id is string => !!id);

  if (candidateIds.length > 0) {
    try {
      const analyticsService: any = req.scope.resolve(ANALYTICS_MODULE);
      const existing: Array<{ event_id?: string | null }> =
        await analyticsService.listAnalyticsEvents(
          { event_id: candidateIds },
          { select: ["event_id"], take: candidateIds.length }
        );
      const existingIds = existing
        .map((e) => e.event_id)
        .filter((id): id is string => !!id);
      const r = filterAlreadyPersisted(normalized, existingIds);
      fresh = r.fresh;
      skipped = r.skipped;
    } catch (e) {
      // Non-fatal: if the dedup lookup fails, fall back to inserting all
      // (within-batch dedup already applied). Better to risk a rare duplicate
      // than to drop real events.
      console.error("ingest-batch dedup lookup failed:", e);
    }
  }

  const userAgent = (req.headers["user-agent"] as string) || "";
  const ip =
    (req.headers["x-forwarded-for"] as string) ||
    req.socket?.remoteAddress ||
    "";

  let accepted = 0;
  let failed = 0;
  for (const e of fresh) {
    try {
      await trackAnalyticsEventWorkflow(req.scope).run({
        input: {
          client_event_id: e.event_id || undefined,
          website_id: e.website_id,
          event_type: e.event_type,
          event_name: e.event_name || undefined,
          pathname: e.pathname,
          referrer: e.referrer || undefined,
          visitor_id: e.visitor_id,
          session_id: e.session_id,
          query_string: e.query_string || undefined,
          is_404: e.is_404,
          utm_source: e.utm_source || undefined,
          utm_medium: e.utm_medium || undefined,
          utm_campaign: e.utm_campaign || undefined,
          utm_term: e.utm_term || undefined,
          utm_content: e.utm_content || undefined,
          // Prefer the geo the edge worker resolved (request.cf.country);
          // the workflow falls back to GeoIP when ip is set and country isn't.
          country: e.country || undefined,
          metadata: e.metadata || undefined,
          user_agent: userAgent,
          ip_address: ip,
          timestamp: e.timestamp,
        },
      });
      accepted++;
    } catch (err) {
      failed++;
      console.error("ingest-batch event failed:", err);
    }
  }

  return res.status(200).json({
    success: true,
    received,
    accepted,
    invalid,
    deduped,
    skipped,
    failed,
  });
};

// Public endpoint: gated by ANALYTICS_INGEST_SECRET (HMAC / shared secret), not session auth.
export const AUTHENTICATE = false;
