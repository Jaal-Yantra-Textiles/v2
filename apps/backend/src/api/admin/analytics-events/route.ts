

/**
 * API route: /api/admin/analytics-events
 *
 * Handles retrieval and creation of analytics event records for the admin API.
 *
 * Overview
 * - GET: Lists analytics events using optional query filters and pagination.
 * - POST: Creates a new analytics event.
 *
 * Implementation notes
 * - Request validation is performed upstream; validated inputs are available on
 *   req.validatedQuery (for GET) and req.validatedBody (for POST).
 * - GET builds a `filters` object containing only the defined query parameters:
 *   website_id, event_type, visitor_id, session_id.
 * - GET passes pagination/selection via a `config` object mapped from:
 *   - offset -> skip
 *   - limit  -> take
 *   - fields -> select (string[])
 * - Both handlers call workflows inside the service layer:
 *   - listAnalyticsEventWorkflow(req.scope).run({ input: { filters, config } })
 *     returns result as [items, count]
 *   - createAnalyticsEventWorkflow(req.scope).run({ input: body }) returns the created entity
 *
 * Exports
 * - GET(req: MedusaRequest<AnalyticsEventQuery>, res: MedusaResponse): Promise<void>
 *   - Success: 200 JSON { analyticsEvents: AnalyticsEvent[], count: number }
 * - POST(req: MedusaRequest<AnalyticsEventCreate>, res: MedusaResponse): Promise<void>
 *   - Success: 201 JSON { analyticsEvent: AnalyticsEvent }
 *
 * Query parameters (AnalyticsEventQuery)
 * - website_id?: string  — filter by website identifier
 * - event_type?: string  — filter by event type (e.g., "page_view", "purchase")
 * - visitor_id?: string  — filter by visitor identifier
 * - session_id?: string  — filter by session identifier
 * - offset?: number      — zero-based offset for pagination (mapped to `skip`)
 * - limit?: number       — page size (mapped to `take`)
 * - fields?: string[]    — list of fields to include (mapped to `select`)
 *
 * Request body (AnalyticsEventCreate)
 * - Should conform to the validator for analytics event creation (required fields depend on validator).
 *
 * Error handling
 * - Validation errors are expected to be handled before these handlers are invoked.
 * - Workflow errors should be thrown from the invoked workflow; the route does not catch them explicitly.
 *
 * Examples
 *
 * GET — list events with filtering, pagination and selected fields
 * curl:
 *   curl -G "https://your-host/api/admin/analytics-events" \
 *     --data-urlencode "website_id=site_123" \
 *     --data-urlencode "event_type=page_view" \
 *     --data-urlencode "offset=0" \
 *     --data-urlencode "limit=20" \
 *     --data-urlencode "fields[]=id" \
 *     --data-urlencode "fields[]=event_type" \
 *     -H "Authorization: Bearer <ADMIN_TOKEN>"
 *
 * Successful response (200):
 * {
 *   "analyticsEvents": [
 *     { "id": "evt_1", "event_type": "page_view", "website_id": "site_123", ... },
 *     ...
 *   ],
 *   "count": 123
 * }
 *
 * POST — create a new analytics event
 * curl:
 *   curl "https://your-host/api/admin/analytics-events" \
 *     -X POST \
 *     -H "Content-Type: application/json" \
 *     -H "Authorization: Bearer <ADMIN_TOKEN>" \
 *     -d '{
 *       "website_id": "site_123",
 *       "event_type": "purchase",
 *       "visitor_id": "visitor_456",
 *       "session_id": "session_789",
 *       "payload": { "order_id": "ord_001", "value": 99.99 }
 *     }'
 *
 * Successful response (201):
 * {
 *   "analyticsEvent": {
 *     "id": "evt_new",
 *     "website_id": "site_123",
 *     "event_type": "purchase",
 *     "visitor_id": "visitor_456",
 *     "session_id": "session_789",
 *     "payload": { "order_id": "ord_001", "value": 99.99 },
 *     "created_at": "2024-01-01T12:00:00.000Z",
 *     ...
 *   }
 * }
 *
 * Notes & best practices
 * - Prefer using the `fields` parameter to limit result payload size for list queries.
 * - Use pagination (offset + limit) when retrieving large result sets.
 * - Ensure authenticated admin requests; these routes are intended for administrative usage.
 *
 * @module admin/analytics-events/route
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { AnalyticsEventCreate, AnalyticsEventQuery } from "./validators";
import { createAnalyticsEventWorkflow } from "../../../workflows/analytics/create-analytics-event";
import { listAnalyticsEventWorkflow } from "../../../workflows/analytics/list-analytics-event";

export const GET = async (
  req: MedusaRequest<AnalyticsEventQuery>,
  res: MedusaResponse
) => {
  const queryParams = req.validatedQuery || {};
  
  // Build filters object with only defined values
  const filters: Record<string, any> = {};
  if (queryParams.website_id) filters.website_id = queryParams.website_id;
  if (queryParams.event_type) filters.event_type = queryParams.event_type;
  if (queryParams.visitor_id) filters.visitor_id = queryParams.visitor_id;
  if (queryParams.session_id) filters.session_id = queryParams.session_id;
  
  const { result } = await listAnalyticsEventWorkflow(req.scope).run({
    input: {
      filters,
      config: {
        skip: queryParams.offset,
        take: queryParams.limit,
        select: queryParams.fields as string[] | undefined,
      },
    },
  });
  
  res.status(200).json({ analyticsEvents: result[0], count: result[1] });
};

export const POST = async (
  req: MedusaRequest<AnalyticsEventCreate>,
  res: MedusaResponse
) => {
  const { result } = await createAnalyticsEventWorkflow(req.scope).run({
    input: req.validatedBody,
  });
  
  res.status(201).json({ analyticsEvent: result });
};
