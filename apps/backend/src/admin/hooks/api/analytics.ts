import { useQuery } from "@tanstack/react-query";
import { sdk } from "../../lib/config";
import { queryKeysFactory } from "../../lib/query-key-factory";
import {
  AnalyticsBreakdownResponse,
  BreakdownQueryParams,
  buildBreakdownQuery,
} from "./analytics-breakdown-query";

export type {
  AnalyticsBreakdownResponse,
  BreakdownBucket,
  BreakdownDimension,
  BreakdownQueryParams,
  BreakdownResult,
} from "./analytics-breakdown-query";
export {
  BREAKDOWN_DIMENSIONS,
  FILTERABLE_FIELDS,
  isBreakdownDimension,
} from "./analytics-breakdown-query";

const ANALYTICS_QUERY_KEY = "analytics" as const;
export const analyticsQueryKeys = queryKeysFactory(ANALYTICS_QUERY_KEY);

// Types
export interface WebsiteAnalyticsResponse {
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
    // Session-derived engagement metrics (#569 S1) — returned by the
    // overview workflow; optional for backwards-compat with older payloads.
    total_sessions?: number;
    bounce_rate?: number;
    avg_session_duration?: number;
    pages_per_session?: number;
    views_per_visitor?: number;
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
}

export interface AnalyticsFilters {
  days?: number
  from?: string        // ISO date string
  to?: string          // ISO date string
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  pathname?: string
  qr_key?: string
  qr_value?: string
}

// Hook to fetch website analytics overview
export const useWebsiteAnalytics = (websiteId: string, filters: AnalyticsFilters | number = { days: 30 }) => {
  // Support legacy numeric `days` argument for backwards compat
  const resolvedFilters: AnalyticsFilters = typeof filters === "number" ? { days: filters } : filters

  return useQuery({
    queryKey: ["website-analytics", websiteId, resolvedFilters],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (resolvedFilters.days != null) params.set("days", String(resolvedFilters.days))
      if (resolvedFilters.from) params.set("from", resolvedFilters.from)
      if (resolvedFilters.to) params.set("to", resolvedFilters.to)
      if (resolvedFilters.utm_source) params.set("utm_source", resolvedFilters.utm_source)
      if (resolvedFilters.utm_medium) params.set("utm_medium", resolvedFilters.utm_medium)
      if (resolvedFilters.utm_campaign) params.set("utm_campaign", resolvedFilters.utm_campaign)
      if (resolvedFilters.pathname) params.set("pathname", resolvedFilters.pathname)
      if (resolvedFilters.qr_key) params.set("qr_key", resolvedFilters.qr_key)
      if (resolvedFilters.qr_value) params.set("qr_value", resolvedFilters.qr_value)
      const res = await sdk.client.fetch<WebsiteAnalyticsResponse>(
        `/admin/websites/${websiteId}/analytics?${params.toString()}`
      );
      return res as WebsiteAnalyticsResponse;
    },
    enabled: !!websiteId,
  });
};

// Session entry/exit page breakdown (#569 S2) — consumes
// GET /admin/websites/:id/analytics/pages (PR #571). Returns ranked landing
// (`entry_page`) and leaving (`exit_page`) pages for the website's sessions
// in the selected window. The envelope mirrors the events breakdown but counts
// sessions (`total_sessions`) rather than events.
export interface SessionPageBucket {
  value: string;
  count: number;
  unique_visitors: number;
  percentage: number;
}

export interface SessionPageBreakdown {
  dimension: "entry_page" | "exit_page";
  total_sessions: number;
  total_unique_visitors: number;
  results: SessionPageBucket[];
}

export interface WebsiteAnalyticsPagesResponse {
  website_id: string;
  period: { start_date?: string; end_date?: string; days?: number };
  pages: {
    entry_page?: SessionPageBreakdown;
    exit_page?: SessionPageBreakdown;
  };
}

export const useWebsiteAnalyticsPages = (
  websiteId: string,
  options?: { days?: number; limit?: number }
) => {
  return useQuery({
    queryKey: ["website-analytics-pages", websiteId, options],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (options?.days != null) params.set("days", String(options.days));
      if (options?.limit != null) params.set("limit", String(options.limit));
      const res = await sdk.client.fetch<WebsiteAnalyticsPagesResponse>(
        `/admin/websites/${websiteId}/analytics/pages?${params.toString()}`
      );
      return res as WebsiteAnalyticsPagesResponse;
    },
    enabled: !!websiteId,
  });
};

// Outbound link clicks breakdown (#569 S5b) — consumes
// GET /admin/websites/:id/analytics/outbound (PR #569 S5a backend). Returns
// the website's external-link (`link_out`) clicks ranked by destination href
// in the selected window. Envelope mirrors the events breakdown but counts the
// `link_out` custom events.
export interface OutboundLinkBucket {
  value: string;
  count: number;
  unique_visitors: number;
  percentage: number;
}

export interface OutboundLinksBreakdown {
  total_events: number;
  total_unique_visitors: number;
  results: OutboundLinkBucket[];
}

export interface WebsiteAnalyticsOutboundResponse {
  website_id: string;
  period: { start_date?: string; end_date?: string; days?: number };
  outbound_links: OutboundLinksBreakdown;
}

export const useWebsiteAnalyticsOutbound = (
  websiteId: string,
  options?: { days?: number; limit?: number }
) => {
  return useQuery({
    queryKey: ["website-analytics-outbound", websiteId, options],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (options?.days != null) params.set("days", String(options.days));
      if (options?.limit != null) params.set("limit", String(options.limit));
      const res = await sdk.client.fetch<WebsiteAnalyticsOutboundResponse>(
        `/admin/websites/${websiteId}/analytics/outbound?${params.toString()}`
      );
      return res as WebsiteAnalyticsOutboundResponse;
    },
    enabled: !!websiteId,
  });
};

// Paginated session list (#569 S7b) — consumes
// GET /admin/websites/:id/analytics/sessions (PR #569 S7a backend). Powers the
// "Sessions" DataTable of the analytics dashboard v2. Server-side paginated via
// limit/offset; orderable by a whitelisted column.
export type SessionOrderField =
  | "started_at"
  | "last_activity_at"
  | "ended_at"
  | "duration_seconds"
  | "pageviews";

export interface AnalyticsSession {
  id: string;
  session_id: string;
  visitor_id?: string | null;
  entry_page?: string | null;
  exit_page?: string | null;
  pageviews?: number | null;
  duration_seconds?: number | null;
  is_bounce?: boolean | null;
  referrer?: string | null;
  referrer_source?: string | null;
  country?: string | null;
  device_type?: string | null;
  browser?: string | null;
  os?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_term?: string | null;
  utm_content?: string | null;
  started_at?: string | Date | null;
  ended_at?: string | Date | null;
  last_activity_at?: string | Date | null;
}

export interface WebsiteAnalyticsSessionsResponse {
  website_id: string;
  period: { start_date?: string; end_date?: string; days?: number };
  limit: number;
  offset: number;
  count: number;
  sessions: AnalyticsSession[];
}

export const useWebsiteAnalyticsSessions = (
  websiteId: string,
  options?: {
    days?: number;
    limit?: number;
    offset?: number;
    order_by?: SessionOrderField;
    order_dir?: "ASC" | "DESC";
  },
  queryOptions?: { placeholderData?: any }
) => {
  return useQuery({
    queryKey: ["website-analytics-sessions", websiteId, options],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (options?.days != null) params.set("days", String(options.days));
      if (options?.limit != null) params.set("limit", String(options.limit));
      if (options?.offset != null) params.set("offset", String(options.offset));
      if (options?.order_by) params.set("order_by", options.order_by);
      if (options?.order_dir) params.set("order_dir", options.order_dir);
      const res = await sdk.client.fetch<WebsiteAnalyticsSessionsResponse>(
        `/admin/websites/${websiteId}/analytics/sessions?${params.toString()}`
      );
      return res as WebsiteAnalyticsSessionsResponse;
    },
    enabled: !!websiteId,
    ...queryOptions,
  });
};

// Hook to fetch analytics stats
export const useAnalyticsStats = (websiteId: string, days: number = 30) => {
  return useQuery({
    queryKey: ["analytics-stats", websiteId, days],
    queryFn: async () => {
      const res = await sdk.client.fetch<any>(
        `/admin/analytics-events/stats?website_id=${websiteId}&days=${days}`
      );
      return res.body;
    },
    enabled: !!websiteId,
  });
};

// Hook to fetch analytics timeseries
export const useAnalyticsTimeseries = (
  websiteId: string,
  days: number = 30,
  interval: "hour" | "day" = "day"
) => {
  return useQuery({
    queryKey: ["analytics-timeseries", websiteId, days, interval],
    queryFn: async () => {
      const res = await sdk.client.fetch<any>(
        `/admin/analytics-events/timeseries?website_id=${websiteId}&days=${days}&interval=${interval}`
      );
      // `sdk.client.fetch` resolves to the parsed JSON body directly (there is
      // no `.body` wrapper) — returning `res.body` yielded `undefined`, which
      // react-query rejects. Mirror the other analytics hooks and return `res`.
      return res;
    },
    enabled: !!websiteId,
  });
};

// Hook to fetch a single-dimension analytics breakdown (#559 slice 4).
// Consumes GET /admin/analytics-events/breakdown (slice 3 / PR #562):
// pass a website + dimension, an optional rolling `days` or explicit
// start/end window, an optional `limit`, and composable equality `filters`.
export const useAnalyticsBreakdown = (
  params: BreakdownQueryParams,
  options?: { enabled?: boolean }
) => {
  const enabled =
    (options?.enabled ?? true) && !!params.website_id && !!params.dimension;

  return useQuery({
    queryKey: ["analytics-breakdown", params],
    queryFn: async () => {
      const qs = buildBreakdownQuery(params);
      const res = await sdk.client.fetch<AnalyticsBreakdownResponse>(
        `/admin/analytics-events/breakdown?${qs}`
      );
      return res as AnalyticsBreakdownResponse;
    },
    enabled,
  });
};

// Hook to fetch analytics events
export const useAnalyticsEvents = (websiteId: string, filters?: Record<string, any>) => {
  const queryParams = new URLSearchParams({
    website_id: websiteId,
    ...filters,
  }).toString();

  return useQuery({
    queryKey: ["analytics-events", websiteId, filters],
    queryFn: async () => {
      const res = await sdk.client.fetch<any>(
        `/admin/analytics-events?${queryParams}`
      );
      return res.body;
    },
    enabled: !!websiteId,
  });
};
