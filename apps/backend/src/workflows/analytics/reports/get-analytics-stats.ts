import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk";
import { ANALYTICS_MODULE } from "../../../modules/analytics";

/**
 * Get Analytics Statistics
 * 
 * Provides aggregated statistics for a website's analytics data.
 * This is the main stats endpoint for dashboards.
 */

export type GetAnalyticsStatsInput = {
  website_id: string;
  start_date?: Date;
  end_date?: Date;
};

export type AnalyticsStats = {
  overview: {
    total_events: number;
    total_pageviews: number;
    total_custom_events: number;
    unique_visitors: number;
    unique_sessions: number;
  };
  top_pages: Array<{
    pathname: string;
    views: number;
    unique_visitors: number;
  }>;
  referrer_sources: Array<{
    source: string;
    count: number;
    percentage: number;
  }>;
  devices: {
    desktop: number;
    mobile: number;
    tablet: number;
    unknown: number;
  };
  browsers: Array<{
    browser: string;
    count: number;
  }>;
  operating_systems: Array<{
    os: string;
    count: number;
  }>;
};

export const getAnalyticsStatsStep = createStep(
  "get-analytics-stats-step",
  async (input: GetAnalyticsStatsInput, { container }) => {
    const analyticsService = container.resolve(ANALYTICS_MODULE) as any;

    // Build filters
    const filters: any = { website_id: input.website_id };
    
    if (input.start_date || input.end_date) {
      filters.timestamp = {};
      if (input.start_date) filters.timestamp.$gte = input.start_date;
      if (input.end_date) filters.timestamp.$lte = input.end_date;
    }

    // Fetch all events for the period
    const [events] = await analyticsService.listAndCountAnalyticsEvents(filters, {
      select: [
        "id",
        "event_type",
        "pathname",
        "referrer_source",
        "visitor_id",
        "session_id",
        "device_type",
        "browser",
        "os",
      ],
    });

    // Calculate overview stats
    const pageviews = events.filter((e: any) => e.event_type === "pageview");
    const customEvents = events.filter((e: any) => e.event_type === "custom_event");
    const uniqueVisitors = new Set(events.map((e: any) => e.visitor_id)).size;
    const uniqueSessions = new Set(events.map((e: any) => e.session_id)).size;

    // Calculate top pages
    const pageViewCounts = new Map<string, { views: number; visitors: Set<string> }>();
    pageviews.forEach((e: any) => {
      const existing = pageViewCounts.get(e.pathname) || { views: 0, visitors: new Set() };
      existing.views++;
      existing.visitors.add(e.visitor_id);
      pageViewCounts.set(e.pathname, existing);
    });

    const topPages = Array.from(pageViewCounts.entries())
      .map(([pathname, data]) => ({
        pathname,
        views: data.views,
        unique_visitors: data.visitors.size,
      }))
      .sort((a, b) => b.views - a.views)
      .slice(0, 10);

    // Calculate referrer sources
    const referrerCounts = new Map<string, number>();
    events.forEach((e: any) => {
      const source = e.referrer_source || "direct";
      referrerCounts.set(source, (referrerCounts.get(source) || 0) + 1);
    });

    const totalWithReferrer = events.length;
    const referrerSources = Array.from(referrerCounts.entries())
      .map(([source, count]) => ({
        source,
        count,
        percentage: Math.round((count / totalWithReferrer) * 100),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Calculate device breakdown
    const devices = {
      desktop: events.filter((e: any) => e.device_type === "desktop").length,
      mobile: events.filter((e: any) => e.device_type === "mobile").length,
      tablet: events.filter((e: any) => e.device_type === "tablet").length,
      unknown: events.filter((e: any) => e.device_type === "unknown").length,
    };

    // Calculate browser breakdown
    const browserCounts = new Map<string, number>();
    events.forEach((e: any) => {
      if (e.browser) {
        browserCounts.set(e.browser, (browserCounts.get(e.browser) || 0) + 1);
      }
    });

    const browsers = Array.from(browserCounts.entries())
      .map(([browser, count]) => ({ browser, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Calculate OS breakdown
    const osCounts = new Map<string, number>();
    events.forEach((e: any) => {
      if (e.os) {
        osCounts.set(e.os, (osCounts.get(e.os) || 0) + 1);
      }
    });

    const operating_systems = Array.from(osCounts.entries())
      .map(([os, count]) => ({ os, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const stats: AnalyticsStats = {
      overview: {
        total_events: events.length,
        total_pageviews: pageviews.length,
        total_custom_events: customEvents.length,
        unique_visitors: uniqueVisitors,
        unique_sessions: uniqueSessions,
      },
      top_pages: topPages,
      referrer_sources: referrerSources,
      devices,
      browsers,
      operating_systems,
    };

    return new StepResponse(stats);
  }
);

export const getAnalyticsStatsWorkflow = createWorkflow(
  "get-analytics-stats",
  (input: GetAnalyticsStatsInput) => {
    const stats = getAnalyticsStatsStep(input);
    return new WorkflowResponse(stats);
  }
);
