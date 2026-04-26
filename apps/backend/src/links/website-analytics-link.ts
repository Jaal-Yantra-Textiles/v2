import { defineLink } from "@medusajs/framework/utils";
import WebsiteModule from "../modules/website";
import AnalyticsModule from "../modules/analytics";

/**
 * Read-only link from Analytics Events to Website
 * 
 * This enables graph queries like:
 * - Get analytics event with website details
 * - Get website with all its analytics events
 * 
 * Uses the existing website_id field in AnalyticsEvent - no join table needed!
 * Read-only means we can query but not modify the relationship.
 */
export default defineLink(
  {
    linkable: WebsiteModule.linkable.website,
    field: "id", // The field in Website to match
    isList: true, // Force one-to-many relation
  },
  {
    ...AnalyticsModule.linkable.analyticsEvent.id,
    primaryKey: "website_id", // The field in AnalyticsEvent that holds the website's ID
  },
  {
    readOnly: true,
  }
);
