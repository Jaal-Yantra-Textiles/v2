import {
  createWorkflow,
  WorkflowResponse,
  createStep,
  StepResponse,
} from "@medusajs/framework/workflows-sdk";
import { ANALYTICS_MODULE } from "../../modules/analytics";

// Helper to parse user agent
function parseUserAgent(userAgent: string) {
  const ua = userAgent.toLowerCase();
  
  // Detect browser
  let browser = "unknown";
  if (ua.includes("firefox")) browser = "Firefox";
  else if (ua.includes("chrome") && !ua.includes("edg")) browser = "Chrome";
  else if (ua.includes("safari") && !ua.includes("chrome")) browser = "Safari";
  else if (ua.includes("edg")) browser = "Edge";
  else if (ua.includes("opera") || ua.includes("opr")) browser = "Opera";
  
  // Detect OS (check iOS before macOS since iOS user agents contain "mac")
  let os = "unknown";
  if (ua.includes("android")) os = "Android";
  else if (ua.includes("iphone") || ua.includes("ipad") || ua.includes("ipod")) os = "iOS";
  else if (ua.includes("win")) os = "Windows";
  else if (ua.includes("mac")) os = "macOS";
  else if (ua.includes("linux")) os = "Linux";
  
  // Detect device type
  let device_type: "desktop" | "mobile" | "tablet" | "unknown" = "unknown";
  if (ua.includes("ipad")) device_type = "tablet";
  else if (ua.includes("iphone") || ua.includes("ipod") || ua.includes("android") && ua.includes("mobile")) device_type = "mobile";
  else if (ua.includes("tablet")) device_type = "tablet";
  else if (browser !== "unknown") device_type = "desktop";
  
  return { browser, os, device_type };
}

// Helper to extract referrer source
function extractReferrerSource(referrer: string | undefined): string | null {
  if (!referrer) return "direct";
  
  try {
    const url = new URL(referrer);
    const hostname = url.hostname.toLowerCase();
    
    // Search engines
    if (hostname.includes("google")) return "google";
    if (hostname.includes("bing")) return "bing";
    if (hostname.includes("yahoo")) return "yahoo";
    if (hostname.includes("duckduckgo")) return "duckduckgo";
    
    // Social media
    if (hostname.includes("facebook")) return "facebook";
    if (hostname.includes("twitter") || hostname.includes("t.co")) return "twitter";
    if (hostname.includes("linkedin")) return "linkedin";
    if (hostname.includes("instagram")) return "instagram";
    if (hostname.includes("pinterest")) return "pinterest";
    if (hostname.includes("reddit")) return "reddit";
    
    // Return domain for other referrers
    return hostname;
  } catch {
    return null;
  }
}

type TrackAnalyticsEventInput = {
  website_id: string;
  event_type: "pageview" | "custom_event";
  event_name?: string;
  pathname: string;
  referrer?: string;
  visitor_id: string;
  session_id: string;
  user_agent: string;
  ip_address: string;
  timestamp: Date;
  metadata?: Record<string, any>;
};

// Step 1: Create analytics event
const createAnalyticsEventStep = createStep(
  "create-analytics-event",
  async (input: TrackAnalyticsEventInput, { container }) => {
    const analyticsService = container.resolve(ANALYTICS_MODULE) as any;

    // Parse user agent
    const { browser, os, device_type } = parseUserAgent(input.user_agent);
    
    // Extract referrer source
    const referrer_source = extractReferrerSource(input.referrer);

    // Create the event
    const event = await analyticsService.createAnalyticsEvents({
      website_id: input.website_id,
      event_type: input.event_type,
      event_name: input.event_name || null,
      pathname: input.pathname,
      referrer: input.referrer || null,
      referrer_source,
      visitor_id: input.visitor_id,
      session_id: input.session_id,
      user_agent: input.user_agent,
      browser,
      os,
      device_type,
      country: null, // TODO: Add GeoIP lookup if needed
      metadata: input.metadata || null,
      timestamp: input.timestamp,
    });

    return new StepResponse(event, event.id);
  },
  async (eventId, { container }) => {
    if (!eventId) return;
    
    const analyticsService = container.resolve(ANALYTICS_MODULE) as any;
    await analyticsService.deleteAnalyticsEvents(eventId);
  }
);

// Step 2: Update or create session
const updateSessionStep = createStep(
  "update-analytics-session",
  async (input: TrackAnalyticsEventInput & { event_id: string }, { container }) => {
    const analyticsService = container.resolve(ANALYTICS_MODULE) as any;

    // Parse user agent for session data
    const { browser, os, device_type } = parseUserAgent(input.user_agent);
    const referrer_source = extractReferrerSource(input.referrer);

    try {
      // Try to find existing session
      const [sessions] = await analyticsService.listAndCountAnalyticsSessions({
        session_id: input.session_id,
      });

      if (sessions.length > 0) {
        // Update existing session
        const session = sessions[0];
        const updated = await analyticsService.updateAnalyticsSessions({
          id: session.id,
          exit_page: input.pathname,
          pageviews: session.pageviews + 1,
          last_activity_at: input.timestamp,
          is_bounce: false, // More than one pageview
        });
        
        return new StepResponse({ session: updated, created: false });
      } else {
        // Create new session
        const session = await analyticsService.createAnalyticsSessions({
          website_id: input.website_id,
          session_id: input.session_id,
          visitor_id: input.visitor_id,
          entry_page: input.pathname,
          exit_page: input.pathname,
          pageviews: 1,
          duration_seconds: null,
          is_bounce: true, // Single page visit initially
          referrer: input.referrer || null,
          referrer_source,
          country: null,
          device_type,
          browser,
          os,
          started_at: input.timestamp,
          ended_at: null,
          last_activity_at: input.timestamp,
        });
        
        return new StepResponse({ session, created: true }, session.id);
      }
    } catch (error) {
      console.error("Session update error:", error);
      return new StepResponse({ session: null, created: false });
    }
  },
  async (sessionId, { container }) => {
    if (!sessionId) return;
    
    const analyticsService = container.resolve(ANALYTICS_MODULE) as any;
    await analyticsService.deleteAnalyticsSessions(sessionId);
  }
);

// Main workflow
export const trackAnalyticsEventWorkflow = createWorkflow(
  "track-analytics-event",
  (input: TrackAnalyticsEventInput) => {
    // Create the event
    const event = createAnalyticsEventStep(input);
    
    // Update or create session
    const session = updateSessionStep({
      ...input,
      event_id: event.id,
    });

    return new WorkflowResponse({
      event,
      session,
    });
  }
);
