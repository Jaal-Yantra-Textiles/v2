/**
 * @file Admin API route for retrieving website tracking code
 * @module api/admin/websites/[id]/tracking-code
 * @description Provides analytics tracking code snippets and usage instructions
 * for integrating JYT Analytics with websites.
 *
 * @example
 * // Get tracking code for website with ID "web_123"
 * GET /admin/websites/web_123/tracking-code
 *
 * @example
 * // Response structure
 * {
 *   "website_id": "web_123",
 *   "tracking_code": "<script src=\"http://localhost:9000/analytics.js\" ...>",
 *   "tracking_code_production": "<script src=\"https://your-domain.com/analytics.js\" ...>",
 *   "instructions": {
 *     "step1": "Copy the tracking code above",
 *     "step2": "Paste it in your website's <head> section or before </body>",
 *     "step3": "Deploy your website",
 *     "step4": "Visit your website to test tracking",
 *     "step5": "Check analytics dashboard to see events"
 *   },
 *   "custom_events": {
 *     "description": "Track custom events using the global API",
 *     "example": "window.jytAnalytics.track('button_click', { button_id: 'signup' })"
 *   },
 *   "api_endpoints": {
 *     "view_events": "GET http://localhost:9000/admin/analytics-events?website_id=web_123",
 *     "filter_by_page": "GET http://localhost:9000/admin/analytics-events?website_id=web_123&pathname=/products",
 *     "filter_by_type": "GET http://localhost:9000/admin/analytics-events?website_id=web_123&event_type=pageview"
 *   }
 * }
 *
 * @example
 * // Usage in HTML
 * <head>
 *   <!-- JYT Analytics -->
 *   <script
 *     src="http://localhost:9000/analytics.js"
 *     data-website-id="web_123"
 *     data-api-url="http://localhost:9000"
 *     defer
 *   ></script>
 * </head>
 *
 * @example
 * // Tracking custom events
 * <button onclick="window.jytAnalytics.track('signup_click', { source: 'hero_banner' })">
 *   Sign Up
 * </button>
 *
 * @example
 * // Production deployment
 * <head>
 *   <!-- JYT Analytics -->
 *   <script
 *     src="https://your-domain.com/analytics.js"
 *     data-website-id="web_123"
 *     data-api-url="https://api.your-domain.com"
 *     defer
 *   ></script>
 * </head>
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework";

/**
 * GET /admin/websites/:id/tracking-code
 * 
 * Returns the analytics tracking code snippet for a website.
 * This makes it easy for admins to copy/paste the tracking code.
 */
export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  const { id } = req.params;
  
  // Get API URL from environment or use default
  const apiUrl = process.env.MEDUSA_BACKEND_URL || 'http://localhost:9000';
  
  // Generate tracking code snippet
  const trackingCode = `<!-- JYT Analytics -->
<script 
  src="${apiUrl}/analytics.js" 
  data-website-id="${id}"
  data-api-url="${apiUrl}"
  defer
></script>`;

  const trackingCodeProduction = `<!-- JYT Analytics -->
<script 
  src="https://your-domain.com/analytics.js" 
  data-website-id="${id}"
  data-api-url="https://api.your-domain.com"
  defer
></script>`;

  res.json({
    website_id: id,
    tracking_code: trackingCode,
    tracking_code_production: trackingCodeProduction,
    instructions: {
      step1: "Copy the tracking code above",
      step2: "Paste it in your website's <head> section or before </body>",
      step3: "Deploy your website",
      step4: "Visit your website to test tracking",
      step5: "Check analytics dashboard to see events",
    },
    custom_events: {
      description: "Track custom events using the global API",
      example: `window.jytAnalytics.track('button_click', { button_id: 'signup' })`,
    },
    api_endpoints: {
      view_events: `GET ${apiUrl}/admin/analytics-events?website_id=${id}`,
      filter_by_page: `GET ${apiUrl}/admin/analytics-events?website_id=${id}&pathname=/products`,
      filter_by_type: `GET ${apiUrl}/admin/analytics-events?website_id=${id}&event_type=pageview`,
    }
  });
};
