import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";

/**
 * Get Website Analytics Overview
 * 
 * Uses the read-only module link to fetch website with analytics in a single query.
 * This is more efficient than separate queries when you need both website and analytics data.
 */

export type GetWebsiteAnalyticsOverviewInput = {
  website_id: string;
  days?: number;          // Default 30 days (ignored when from/to provided)
  from?: string;          // ISO date string — start of range
  to?: string;            // ISO date string — end of range (defaults to now)
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  pathname?: string;      // Substring match
  qr_key?: string;        // Query param key in query_string
  qr_value?: string;      // Corresponding value
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
    query_string?: string;
    timestamp: Date;
    visitor_id?: string;
    session_id?: string;
    referrer_source?: string;
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
    country?: string;
  }>;
};

export const getWebsiteAnalyticsOverviewStep = createStep(
  "get-website-analytics-overview-step",
  async (input: GetWebsiteAnalyticsOverviewInput, { container }) => {
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY);

    // Compute date range
    const endDate = input.to ? new Date(input.to) : new Date();
    const startDate = input.from
      ? new Date(input.from)
      : new Date(endDate.getTime() - (input.days || 30) * 24 * 60 * 60 * 1000);

    // Use graph query to get website with all analytics events via read-only link
    const { data: websites } = await query.graph({
      entity: "website",
      fields: [
        "id", "domain", "name", "status",
        "analytics_event.*",
      ],
      filters: { id: input.website_id },
    });

    if (!websites || websites.length === 0) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, `Website not found: ${input.website_id}`);
    }

    const website = websites[0] as any;
    const allEvents = website.analytics_event || [];

    // Apply filters
    let filteredEvents = allEvents.filter((event: any) => {
      const ts = new Date(event.timestamp);
      if (ts < startDate || ts > endDate) return false;
      if (input.utm_source && event.utm_source !== input.utm_source) return false;
      if (input.utm_medium && event.utm_medium !== input.utm_medium) return false;
      if (input.utm_campaign && event.utm_campaign !== input.utm_campaign) return false;
      if (input.pathname && !(event.pathname ?? "").includes(input.pathname)) return false;
      if (input.qr_key) {
        const qs = event.query_string ?? "";
        const needle = input.qr_value
          ? `${encodeURIComponent(input.qr_key)}=${encodeURIComponent(input.qr_value)}`
          : encodeURIComponent(input.qr_key) + "=";
        if (!qs.includes(needle)) return false;
      }
      return true;
    });

    // Calculate stats
    const pageviews = filteredEvents.filter((e: any) => e.event_type === "pageview");
    const customEvents = filteredEvents.filter((e: any) => e.event_type === "custom_event");
    const uniqueVisitors = new Set(filteredEvents.map((e: any) => e.visitor_id)).size;
    const uniqueSessions = new Set(filteredEvents.map((e: any) => e.session_id)).size;

    // Get most recent events (last 100)
    const latestEvents = filteredEvents
      .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 100)
      .map((e: any) => ({
        id: e.id,
        event_type: e.event_type,
        event_name: e.event_name,
        pathname: e.pathname,
        query_string: e.query_string,
        timestamp: e.timestamp,
        visitor_id: e.visitor_id,
        session_id: e.session_id,
        referrer_source: e.referrer_source,
        utm_source: e.utm_source,
        utm_medium: e.utm_medium,
        utm_campaign: e.utm_campaign,
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
        total_events: filteredEvents.length,
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
