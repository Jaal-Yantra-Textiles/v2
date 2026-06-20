import { MedusaContainer } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import { trackAnalyticsEventWorkflow } from "../workflows/analytics/track-analytics-event";
import {
  drainBuffer,
  getIngestRedis,
  isBatchIngestEnabled,
  orderAndDedupeBuffer,
} from "../modules/analytics/lib/ingest-buffer";

/**
 * Drain Analytics Buffer Job (#559 slice 2).
 *
 * Consumer half of the in-house ingestion queue. Every minute (Medusa cron's
 * finest granularity) it RPOPs a batch off the Redis buffer that
 * `/web/analytics/track` fills (when ANALYTICS_BATCH_INGEST is on) and persists
 * each event via the existing `trackAnalyticsEventWorkflow` — a SHORT-LIVED
 * workflow per event, not a long-running one. This decouples the visitor request
 * from the DB write while keeping session/rollup logic identical to the
 * synchronous path.
 *
 * Heartbeats never reach the buffer (they write through synchronously), so the
 * live-visitor count stays real-time regardless of this drain cadence.
 *
 * locking-redis guards the drain so overlapping ticks / multiple Fargate
 * instances can't double-process the same keys.
 */
const DRAIN_MAX =
  Number(process.env.ANALYTICS_DRAIN_MAX) > 0
    ? Number(process.env.ANALYTICS_DRAIN_MAX)
    : 500;
const LOCK_KEY = "analytics-buffer-drain";

export default async function drainAnalyticsBuffer(container: MedusaContainer) {
  // Nothing is buffered when the flag is off — skip without touching Redis.
  if (!isBatchIngestEnabled()) return;

  const logger = container.resolve("logger");
  const locking = container.resolve(Modules.LOCKING) as any;

  try {
    await locking.execute(LOCK_KEY, async () => {
      const redis = getIngestRedis();
      const drained = await drainBuffer(redis, DRAIN_MAX);
      if (!drained.length) return;

      const events = orderAndDedupeBuffer(drained);
      let persisted = 0;
      let failed = 0;

      for (const e of events) {
        try {
          await trackAnalyticsEventWorkflow(container).run({
            input: {
              client_event_id: e.event_id,
              website_id: e.website_id,
              event_type: e.event_type,
              event_name: e.event_name,
              pathname: e.pathname,
              referrer: e.referrer,
              visitor_id: e.visitor_id,
              session_id: e.session_id,
              query_string: e.query_string,
              is_404: e.is_404,
              utm_source: e.utm_source,
              utm_medium: e.utm_medium,
              utm_campaign: e.utm_campaign,
              utm_term: e.utm_term,
              utm_content: e.utm_content,
              timezone: e.timezone,
              locale: e.locale,
              country: e.country,
              metadata: e.metadata,
              user_agent: e.user_agent,
              ip_address: e.ip_address,
              timestamp: new Date(e.timestamp),
            },
          });
          persisted++;
        } catch (err) {
          // Per-event failure must not abort the batch.
          failed++;
          logger.error(
            `[analytics-drain] event ${e.event_id} failed: ${
              (err as Error)?.message
            }`
          );
        }
      }

      logger.info(
        `[analytics-drain] persisted=${persisted} failed=${failed} drained=${events.length}`
      );
    });
  } catch (lockErr) {
    // Lock contention / Redis hiccup — skip this tick; the next one retries.
    logger.warn(
      `[analytics-drain] skipped tick: ${(lockErr as Error)?.message}`
    );
  }
}

export const config = {
  name: "drain-analytics-buffer",
  // Every minute — Medusa cron's finest granularity. Bulk firehose only;
  // heartbeats are synchronous so live data is unaffected by this cadence.
  schedule: "* * * * *",
};
