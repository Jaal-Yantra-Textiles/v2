import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

/**
 * Get Website Analytics Overview
 * 
 * Uses the read-only module link to fetch website with analytics in a single query.
 * This is more efficient than separate queries when you need both website and analytics data.
 */

export type GetWebsiteAnalyticsOverviewInput = {
  website_id: string;
  days?: number; // Default 30 days
};

export type WebsiteAnalyticsOverview = {
  website: {
    id: string;
    domain: string;
    name: string;
    status: string;
  };
  stats: {
    total_events: number;
    total_pageviews: number;
    total_custom_events: number;
    unique_visitors: number;
    unique_sessions: number;
  };
  recent_events: Array<{
    id: string;
    event_type: string;
    event_name?: string;
    pathname: string;
    timestamp: Date;
    visitor_id?: string;
    session_id?: string;
    referrer_source?: string;
    country?: string;
  }>;
};

export const getWebsiteAnalyticsOverviewStep = createStep(
  "get-website-analytics-overview-step",
  async (input: GetWebsiteAnalyticsOverviewInput, { container }) => {
    const query:any = container.resolve(ContainerRegistrationKeys.QUERY);
    const days = input.days || 30;
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Use graph query to get website with all analytics events via read-only link
    const { data: websites } = await query.graph({
      entity: "website",
      fields: ["id", "domain", "name", "status", "analytics_event.*"],
      filters: { id: input.website_id },
    });

    if (!websites || websites.length === 0) {
      throw new Error(`Website not found: ${input.website_id}`);
    }

    const website = websites[0] as any;
    const allEvents = website.analytics_event || [];

    // Filter events by date range
    const recentEvents = allEvents.filter(
      (event: any) => new Date(event.timestamp) >= startDate
    );

    // Calculate stats
    const pageviews = recentEvents.filter((e: any) => e.event_type === "pageview");
    const customEvents = recentEvents.filter((e: any) => e.event_type === "custom_event");
    const uniqueVisitors = new Set(recentEvents.map((e: any) => e.visitor_id)).size;
    const uniqueSessions = new Set(recentEvents.map((e: any) => e.session_id)).size;

    // Get most recent events (last 100)
    const latestEvents = recentEvents
      .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 100)
      .map((e: any) => ({
        id: e.id,
        event_type: e.event_type,
        event_name: e.event_name,
        pathname: e.pathname,
        timestamp: e.timestamp,
        visitor_id: e.visitor_id,
        session_id: e.session_id,
        referrer_source: e.referrer_source,
        country: e.country,
      }));

    const overview: WebsiteAnalyticsOverview = {
      website: {
        id: website.id,
        domain: website.domain,
        name: website.name,
        status: website.status,
      },
      stats: {
        total_events: recentEvents.length,
        total_pageviews: pageviews.length,
        total_custom_events: customEvents.length,
        unique_visitors: uniqueVisitors,
        unique_sessions: uniqueSessions,
      },
      recent_events: latestEvents,
    };

    return new StepResponse(overview);
  }
);

export const getWebsiteAnalyticsOverviewWorkflow = createWorkflow(
  "get-website-analytics-overview",
  (input: GetWebsiteAnalyticsOverviewInput) => {
    const overview = getWebsiteAnalyticsOverviewStep(input);
    return new WorkflowResponse(overview);
  }
);
