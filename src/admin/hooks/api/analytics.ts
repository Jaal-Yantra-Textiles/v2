import { useQuery } from "@tanstack/react-query";
import { sdk } from "../../lib/config";
import { queryKeysFactory } from "../../lib/query-key-factory";

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

// Hook to fetch website analytics overview
export const useWebsiteAnalytics = (websiteId: string, days: number = 30) => {
  return useQuery({
    queryKey: ["website-analytics", websiteId, days],
    queryFn: async () => {
      const res = await sdk.client.fetch<WebsiteAnalyticsResponse>(
        `/admin/websites/${websiteId}/analytics?days=${days}`
      );
      // The response is the data directly, not wrapped in body
      return res as WebsiteAnalyticsResponse;
    },
    enabled: !!websiteId,
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
      return res.body;
    },
    enabled: !!websiteId,
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
