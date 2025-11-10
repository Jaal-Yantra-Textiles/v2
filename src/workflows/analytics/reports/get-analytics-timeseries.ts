import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk";
import { ANALYTICS_MODULE } from "../../../modules/analytics";

/**
 * Get Analytics Time Series Data
 * 
 * Returns event counts grouped by time intervals (hourly or daily).
 * Perfect for charts and graphs.
 */

export type GetAnalyticsTimeseriesInput = {
  website_id: string;
  start_date: Date;
  end_date: Date;
  interval?: "hour" | "day"; // Default: "day"
};

export type TimeseriesDataPoint = {
  timestamp: string;
  pageviews: number;
  custom_events: number;
  total_events: number;
  unique_visitors: number;
  unique_sessions: number;
};

export const getAnalyticsTimeseriesStep = createStep(
  "get-analytics-timeseries-step",
  async (input: GetAnalyticsTimeseriesInput, { container }) => {
    const analyticsService = container.resolve(ANALYTICS_MODULE) as any;
    const interval = input.interval || "day";

    // Fetch all events for the period
    const [events] = await analyticsService.listAndCountAnalyticsEvents(
      {
        website_id: input.website_id,
        timestamp: {
          $gte: input.start_date,
          $lte: input.end_date,
        },
      },
      {
        select: ["id", "event_type", "timestamp", "visitor_id", "session_id"],
      }
    );

    // Group events by time interval
    const groupedData = new Map<string, {
      pageviews: number;
      custom_events: number;
      visitors: Set<string>;
      sessions: Set<string>;
    }>();

    events.forEach((event: any) => {
      const timestamp = new Date(event.timestamp);
      
      // Round to interval
      let key: string;
      if (interval === "hour") {
        timestamp.setMinutes(0, 0, 0);
        key = timestamp.toISOString();
      } else {
        timestamp.setHours(0, 0, 0, 0);
        key = timestamp.toISOString().split('T')[0];
      }

      const existing = groupedData.get(key) || {
        pageviews: 0,
        custom_events: 0,
        visitors: new Set(),
        sessions: new Set(),
      };

      if (event.event_type === "pageview") {
        existing.pageviews++;
      } else if (event.event_type === "custom_event") {
        existing.custom_events++;
      }

      existing.visitors.add(event.visitor_id);
      existing.sessions.add(event.session_id);

      groupedData.set(key, existing);
    });

    // Fill in missing intervals with zeros
    const timeseries: TimeseriesDataPoint[] = [];
    const current = new Date(input.start_date);
    
    while (current <= input.end_date) {
      let key: string;
      if (interval === "hour") {
        current.setMinutes(0, 0, 0);
        key = current.toISOString();
      } else {
        current.setHours(0, 0, 0, 0);
        key = current.toISOString().split('T')[0];
      }

      const data = groupedData.get(key);
      
      timeseries.push({
        timestamp: key,
        pageviews: data?.pageviews || 0,
        custom_events: data?.custom_events || 0,
        total_events: (data?.pageviews || 0) + (data?.custom_events || 0),
        unique_visitors: data?.visitors.size || 0,
        unique_sessions: data?.sessions.size || 0,
      });

      // Increment by interval
      if (interval === "hour") {
        current.setHours(current.getHours() + 1);
      } else {
        current.setDate(current.getDate() + 1);
      }
    }

    return new StepResponse(timeseries);
  }
);

export const getAnalyticsTimeseriesWorkflow = createWorkflow(
  "get-analytics-timeseries",
  (input: GetAnalyticsTimeseriesInput) => {
    const timeseries = getAnalyticsTimeseriesStep(input);
    return new WorkflowResponse(timeseries);
  }
);
