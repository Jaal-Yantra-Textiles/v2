/**
 * Verify the intent-scoring pipeline end-to-end against synthetic data.
 *
 * Seeds three fixture visitors (high / medium / low) with realistic
 * analytics_event + conversion rows, runs the same aggregation
 * GET /web/ad-planning/intent uses, and prints expected vs actual.
 *
 * Idempotent — fixture rows are keyed on stable visitor_ids so re-runs
 * just delete the previous fixtures before re-seeding.
 *
 *   npx medusa exec ./src/scripts/check-visitor-intent.ts
 */

import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { AD_PLANNING_MODULE } from "../modules/ad-planning";
import { ANALYTICS_MODULE } from "../modules/analytics";

type Fixture = {
  visitorId: string;
  expectedLevel: "low" | "medium" | "high";
  expectedScoreMin: number;
  expectedScoreMax: number;
  pageviews: number;
  pageEngagements: number;
  scrollDepths: Array<{ page: string; depth: number }>;
  timeOnSite: Array<{ page: string; seconds: number }>;
};

const FIXTURES: Fixture[] = [
  {
    visitorId: "visitor_test_high_intent",
    expectedLevel: "high",
    expectedScoreMin: 70,
    expectedScoreMax: 100,
    pageviews: 7,
    pageEngagements: 2,
    scrollDepths: [
      { page: "/products/winter-coat", depth: 25 },
      { page: "/products/winter-coat", depth: 50 },
      { page: "/products/winter-coat", depth: 75 },
      { page: "/products/winter-coat", depth: 100 },
    ],
    timeOnSite: [
      { page: "/products/winter-coat", seconds: 30 },
      { page: "/products/winter-coat", seconds: 60 },
      { page: "/products/winter-coat", seconds: 120 },
      { page: "/products/winter-coat", seconds: 300 },
    ],
  },
  {
    visitorId: "visitor_test_medium_intent",
    expectedLevel: "medium",
    expectedScoreMin: 30,
    expectedScoreMax: 69,
    pageviews: 3,
    pageEngagements: 0,
    scrollDepths: [{ page: "/categories/coats", depth: 50 }],
    timeOnSite: [{ page: "/categories/coats", seconds: 30 }],
  },
  {
    visitorId: "visitor_test_low_intent",
    expectedLevel: "low",
    expectedScoreMin: 0,
    expectedScoreMax: 29,
    pageviews: 1,
    pageEngagements: 0,
    scrollDepths: [],
    timeOnSite: [],
  },
];

const FIXTURE_WEBSITE_ID = "01TESTINTENTFIXTUREWEBSITE";

export default async function checkVisitorIntent({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const adPlanning = container.resolve(AD_PLANNING_MODULE) as any;
  const analytics = container.resolve(ANALYTICS_MODULE) as any;

  logger.info("─".repeat(70));
  logger.info("Intent-score verification — seeding fixtures and re-running aggregation");
  logger.info("─".repeat(70));

  for (const fx of FIXTURES) {
    // Wipe any prior run for this visitor_id so the script is idempotent.
    const oldEvents = await analytics.listAnalyticsEvents({ visitor_id: fx.visitorId });
    if (oldEvents.length) {
      await analytics.deleteAnalyticsEvents(oldEvents.map((e: any) => e.id));
    }
    const oldConversions = await adPlanning.listConversions({ visitor_id: fx.visitorId });
    if (oldConversions.length) {
      await adPlanning.deleteConversions(oldConversions.map((c: any) => c.id));
    }

    // Seed pageviews + engagement events.
    const eventsToCreate: any[] = [];
    for (let i = 0; i < fx.pageviews; i++) {
      eventsToCreate.push({
        website_id: FIXTURE_WEBSITE_ID,
        visitor_id: fx.visitorId,
        session_id: `session_test_${fx.visitorId}`,
        event_type: "pageview",
        pathname: "/products/winter-coat",
        timestamp: new Date(Date.now() - i * 1000),
      });
    }
    for (let i = 0; i < fx.pageEngagements; i++) {
      eventsToCreate.push({
        website_id: FIXTURE_WEBSITE_ID,
        visitor_id: fx.visitorId,
        session_id: `session_test_${fx.visitorId}`,
        event_type: "custom_event",
        event_name: "page_engagement",
        pathname: "/products/winter-coat",
        metadata: { page: "/products/winter-coat", time_on_page: 300, max_scroll_depth: 100 },
        timestamp: new Date(),
      });
    }
    if (eventsToCreate.length) {
      await analytics.createAnalyticsEvents(eventsToCreate);
    }

    // Seed conversion rows for scroll depth + time on site.
    const conversionsToCreate: any[] = [];
    for (const sd of fx.scrollDepths) {
      conversionsToCreate.push({
        website_id: FIXTURE_WEBSITE_ID,
        conversion_type: "scroll_depth",
        visitor_id: fx.visitorId,
        session_id: `session_test_${fx.visitorId}`,
        currency: "INR",
        attribution_model: "last_click",
        platform: "direct",
        converted_at: new Date(),
        metadata: { page: sd.page, depth: sd.depth },
      });
    }
    for (const t of fx.timeOnSite) {
      conversionsToCreate.push({
        website_id: FIXTURE_WEBSITE_ID,
        conversion_type: "time_on_site",
        visitor_id: fx.visitorId,
        session_id: `session_test_${fx.visitorId}`,
        currency: "INR",
        attribution_model: "last_click",
        platform: "direct",
        converted_at: new Date(),
        metadata: { page: t.page, seconds: t.seconds },
      });
    }
    if (fx.pageEngagements > 0) {
      conversionsToCreate.push({
        website_id: FIXTURE_WEBSITE_ID,
        conversion_type: "page_engagement",
        visitor_id: fx.visitorId,
        session_id: `session_test_${fx.visitorId}`,
        currency: "INR",
        attribution_model: "last_click",
        platform: "direct",
        converted_at: new Date(),
        metadata: {},
      });
    }
    if (conversionsToCreate.length) {
      await adPlanning.createConversions(conversionsToCreate);
    }

    // Run the same aggregation the route uses.
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const events = await analytics.listAnalyticsEvents(
      { visitor_id: fx.visitorId, timestamp: { $gte: since } },
      { take: 1000, order: { timestamp: "DESC" } },
    );
    let pageviews = 0;
    let hasEngagement = false;
    for (const e of events) {
      if (e.event_type === "pageview") pageviews++;
      if (e.event_name === "page_engagement") hasEngagement = true;
    }

    const conversions = await adPlanning.listConversions(
      { visitor_id: fx.visitorId, converted_at: { $gte: since } },
      { take: 1000, order: { converted_at: "DESC" } },
    );
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

    const result = adPlanning.computeIntentScore({
      pageviews,
      maxScrollDepth,
      totalTimeOnSite,
      hasEngagement,
    });

    const pass =
      result.level === fx.expectedLevel &&
      result.score >= fx.expectedScoreMin &&
      result.score <= fx.expectedScoreMax;

    logger.info("");
    logger.info(`${pass ? "✅" : "❌"} ${fx.visitorId}`);
    logger.info(
      `   signals: pv=${pageviews}  scroll=${maxScrollDepth}  time=${totalTimeOnSite}s  engagement=${hasEngagement}`,
    );
    logger.info(
      `   score=${result.score} level=${result.level} (expected ${fx.expectedLevel}, ${fx.expectedScoreMin}-${fx.expectedScoreMax})`,
    );
    logger.info(`   breakdown: ${JSON.stringify(result.breakdown)}`);

    if (!pass) {
      throw new Error(
        `Intent score mismatch for ${fx.visitorId}: got ${result.score}/${result.level}, expected ${fx.expectedScoreMin}-${fx.expectedScoreMax}/${fx.expectedLevel}`,
      );
    }
  }

  // Cleanup. Comment this block to inspect rows in the DB after a run.
  for (const fx of FIXTURES) {
    const events = await analytics.listAnalyticsEvents({ visitor_id: fx.visitorId });
    if (events.length) {
      await analytics.deleteAnalyticsEvents(events.map((e: any) => e.id));
    }
    const conversions = await adPlanning.listConversions({ visitor_id: fx.visitorId });
    if (conversions.length) {
      await adPlanning.deleteConversions(conversions.map((c: any) => c.id));
    }
  }

  logger.info("");
  logger.info("─".repeat(70));
  logger.info("All fixtures verified. Cleaned up.");
  logger.info("─".repeat(70));
}
