/**
 * Web Visitor Intent API
 * Public read-only endpoint that aggregates browsing signals for an
 * anonymous visitor (scroll depth, time on site, pageviews, engagement)
 * into a 0-100 intent score plus low/medium/high band.
 *
 * Storefront callers use this to decide whether to show a soft
 * email-capture prompt: high intent → modal, medium → inline field
 * in the mini-cart, low → nothing (likely a bot or 1-pageview bounce).
 *
 * Pure read — no writes. Score is computed live; we don't persist a
 * VisitorScore row because (a) `customer_score` requires a person_id
 * we don't have for anonymous traffic and (b) the underlying signals
 * already live in `analytics_event` and `conversion` so caching adds
 * staleness without saving meaningful work for a single-visitor query.
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { z } from "@medusajs/framework/zod";
import { AD_PLANNING_MODULE } from "../../../../modules/ad-planning";
import { ANALYTICS_MODULE } from "../../../../modules/analytics";

const QuerySchema = z.object({
  visitor_id: z.string().min(1),
  // Default to 24h. Anything larger than 7d is rejected — cart-recovery
  // signals decay fast and a wider window mostly amortizes noise.
  window_hours: z
    .preprocess(
      (v) => (v == null || v === "" ? undefined : Number(v)),
      z.number().int().min(1).max(168).default(24),
    ),
});

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const parsed = QuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_query", issues: parsed.error.issues });
    return;
  }
  const { visitor_id, window_hours } = parsed.data;
  const since = new Date(Date.now() - window_hours * 3600 * 1000);

  const adPlanning = req.scope.resolve(AD_PLANNING_MODULE) as any;
  const analytics = req.scope.resolve(ANALYTICS_MODULE) as any;

  // Pageviews + engagement flag from analytics_event.
  // listAnalyticsEvents returns rows in insertion order; we just need
  // counts and a presence check, so a single fetch (capped) is fine.
  const events = await analytics.listAnalyticsEvents(
    { visitor_id, timestamp: { $gte: since } },
    { take: 1000, order: { timestamp: "DESC" } },
  );

  let pageviews = 0;
  let hasEngagement = false;
  for (const e of events) {
    if (e.event_type === "pageview") pageviews++;
    if (e.event_name === "page_engagement") hasEngagement = true;
  }

  // Scroll depth and time-on-site from conversion rows.
  // The storefront tracker emits scroll_depth at thresholds (25/50/75/90/100)
  // and time_on_site at thresholds (30/60/120/...). MAX per page is the
  // signal we want — summing thresholds would double-count progress.
  const conversions = await adPlanning.listConversions(
    { visitor_id, converted_at: { $gte: since } },
    { take: 1000, order: { converted_at: "DESC" } },
  );

  // Per-page best signals so we don't sum threshold-cumulative rows.
  const perPage = new Map<string, { maxScroll: number; maxTime: number }>();
  for (const c of conversions) {
    const md = (c.metadata ?? {}) as Record<string, any>;
    const page = (md.page as string | undefined) ?? "_unknown";
    const entry = perPage.get(page) ?? { maxScroll: 0, maxTime: 0 };
    if (c.conversion_type === "scroll_depth") {
      const d = Number(md.depth ?? 0);
      if (Number.isFinite(d) && d > entry.maxScroll) entry.maxScroll = d;
    } else if (c.conversion_type === "time_on_site") {
      const t = Number(md.seconds ?? 0);
      if (Number.isFinite(t) && t > entry.maxTime) entry.maxTime = t;
    } else if (c.conversion_type === "page_engagement") {
      // Reinforce the engagement flag from analytics_event in case the
      // two streams diverged.
      hasEngagement = true;
    }
    perPage.set(page, entry);
  }

  let maxScrollDepth = 0;
  let totalTimeOnSite = 0;
  for (const v of perPage.values()) {
    if (v.maxScroll > maxScrollDepth) maxScrollDepth = v.maxScroll;
    totalTimeOnSite += v.maxTime;
  }

  const lastSeenAt = events[0]?.timestamp ?? null;

  const { score, level, breakdown } = adPlanning.computeIntentScore({
    pageviews,
    maxScrollDepth,
    totalTimeOnSite,
    hasEngagement,
  });

  res.status(200).json({
    visitor_id,
    score,
    level,
    breakdown,
    signals: {
      pageviews,
      unique_pages: perPage.size,
      max_scroll_depth: maxScrollDepth,
      total_time_on_site_seconds: totalTimeOnSite,
      has_engagement: hasEngagement,
      last_seen_at: lastSeenAt,
    },
    window_hours,
    calculated_at: new Date().toISOString(),
  });
};

// Public endpoint — visitor_id is a client-controlled cookie, so the
// caller can only read their own (or anyone else's, which exposes only
// non-sensitive engagement counts).
export const AUTHENTICATE = false;
