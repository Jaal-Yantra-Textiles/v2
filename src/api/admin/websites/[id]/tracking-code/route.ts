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
