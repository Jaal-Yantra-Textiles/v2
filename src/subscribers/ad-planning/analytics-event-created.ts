/**
 * Analytics Event Created Subscriber
 *
 * Checks analytics events against conversion goals and tracks conversions.
 */

import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { AD_PLANNING_MODULE } from "../../modules/ad-planning";
import { trackConversionWorkflow } from "../../workflows/ad-planning/conversions/track-conversion";

type AnalyticsEventCreatedEvent = {
  id: string;
  event_name: string;
  event_type?: string;
  session_id?: string;
  visitor_id?: string;
  website_id?: string;
  page_url?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  event_data?: Record<string, any>;
};

// Map analytics event names to conversion types
const EVENT_TO_CONVERSION_MAP: Record<string, string> = {
  add_to_cart: "add_to_cart",
  begin_checkout: "begin_checkout",
  scroll_depth: "scroll_depth",
  time_on_page: "time_on_site",
  page_engagement: "page_engagement",
  lead_submit: "lead_form_submission",
  form_submit: "lead_form_submission",
};

export default async function analyticsEventCreatedHandler({
  event: { data },
  container,
}: SubscriberArgs<AnalyticsEventCreatedEvent>) {
  try {
    const analyticsEvent = data;

    // Skip if no event name
    if (!analyticsEvent.event_name) {
      return;
    }

    const eventName = analyticsEvent.event_name.toLowerCase();

    // Check if this event maps to a conversion type
    const conversionType = EVENT_TO_CONVERSION_MAP[eventName];

    if (!conversionType) {
      // Check if there's a custom conversion goal for this event
      const adPlanningService = container.resolve(AD_PLANNING_MODULE);

      const customGoals = await adPlanningService.listConversionGoals({
        goal_type: "custom",
        is_active: true,
      });

      const matchingGoal = customGoals.find((goal: any) => {
        const goalEventName = goal.trigger_event_name?.toLowerCase();
        return goalEventName === eventName;
      });

      if (!matchingGoal) {
        // No matching conversion type or goal
        return;
      }

      // Track as custom conversion
      await trackConversionWorkflow(container).run({
        input: {
          conversion_type: "custom",
          visitor_id: analyticsEvent.visitor_id,
          session_id: analyticsEvent.session_id,
          website_id: analyticsEvent.website_id,
          utm_source: analyticsEvent.utm_source,
          utm_medium: analyticsEvent.utm_medium,
          utm_campaign: analyticsEvent.utm_campaign,
          utm_term: analyticsEvent.utm_term,
          utm_content: analyticsEvent.utm_content,
          conversion_page: analyticsEvent.page_url,
          custom_event_name: analyticsEvent.event_name,
          conversion_value: matchingGoal.default_value ? Number(matchingGoal.default_value) : 0,
          metadata: analyticsEvent.event_data,
        },
      });

      console.log(`[AdPlanning] Custom conversion tracked for event: ${eventName}`);
      return;
    }

    // Track standard conversion
    await trackConversionWorkflow(container).run({
      input: {
        conversion_type: conversionType as any,
        visitor_id: analyticsEvent.visitor_id,
        session_id: analyticsEvent.session_id,
        website_id: analyticsEvent.website_id,
        utm_source: analyticsEvent.utm_source,
        utm_medium: analyticsEvent.utm_medium,
        utm_campaign: analyticsEvent.utm_campaign,
        utm_term: analyticsEvent.utm_term,
        utm_content: analyticsEvent.utm_content,
        conversion_page: analyticsEvent.page_url,
        metadata: analyticsEvent.event_data,
      },
    });

    console.log(`[AdPlanning] Conversion tracked for event: ${eventName}`);
  } catch (error) {
    console.error("[AdPlanning] Failed to process analytics event:", error);
  }
}

export const config: SubscriberConfig = {
  event: "analytics_event.created",
};
