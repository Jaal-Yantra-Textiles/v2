
/**
 * Route: /api/admin/analytics-events/:id
 *
 * Handlers:
 *  - GET:    Retrieve a single analytics event by ID.
 *  - POST:   Update an existing analytics event (partial updates supported via validated body).
 *  - DELETE: Delete an analytics event by ID.
 *
 * Security:
 *  - These endpoints are intended for admin usage and expect authentication (e.g., Authorization: Bearer <token>).
 *  - Authorization and scope handling are performed by the surrounding Medusa/framework scope and workflows.
 *
 * Behavior:
 *  - Each handler delegates business logic to a workflow:
 *      - listAnalyticsEventWorkflow for GET (filters by id).
 *      - updateAnalyticsEventWorkflow for POST (applies validated updates).
 *      - deleteAnalyticsEventWorkflow for DELETE (removes the entity).
 *  - Successful responses return HTTP 200 and JSON shaped as described in the examples below.
 *  - Validation for POST uses the AnalyticsEventUpdate validator; invalid input will result in a validation error (HTTP 4xx) from the framework.
 *  - Not-found or workflow errors are propagated from the workflows and should be handled by the framework/global error middleware.
 *
 * Parameters:
 *  - req.params.id (string) — The unique identifier of the analytics event to fetch, update, or delete.
 *  - For POST: req.validatedBody (AnalyticsEventUpdate) — The validated update payload.
 *
 * Responses:
 *  - GET 200:
 *    {
 *      "analyticsEvent": { /* analytics event object or null if not found *\/ }
 *    }
 *
 *  - POST 200:
 *    {
 *      "analyticsEvent": { /* updated analytics event object *\/ }
 *    }
 *
 *  - DELETE 200:
 *    {
 *      "id": "<id>",
 *      "object": "analyticsEvent",
 *      "deleted": true
 *    }
 *
 * Examples:
 *
 *  - GET a single analytics event
 *    curl -X GET "https://example.com/api/admin/analytics-events/evt_123" \
 *      -H "Authorization: Bearer <ADMIN_TOKEN>" \
 *      -H "Accept: application/json"
 *
 *    Successful response (200):
 *    {
 *      "analyticsEvent": {
 *        "id": "evt_123",
 *        "name": "user_signed_up",
 *        "payload": { /* ... *\/ },
 *        "created_at": "2024-01-01T00:00:00.000Z",
 *        /* other fields *\/
 *      }
 *    }
 *
 *  - POST (update) an analytics event
 *    curl -X POST "https://example.com/admin/analytics-events/evt_123" \
 *      -H "Authorization: Bearer <ADMIN_TOKEN>" \
 *      -H "Content-Type: application/json" \
 *      -d '{
 *            "name": "user_registered",
 *            "metadata": { "source": "campaign_x" }
 *          }'
 *
 *    Notes:
 *      - The body must conform to the AnalyticsEventUpdate validator (partial updates allowed).
 *
 *    Successful response (200):
 *    {
 *      "analyticsEvent": {
 *        "id": "evt_123",
 *        "name": "user_registered",
 *        "metadata": { "source": "campaign_x" },
 *        /* updated fields *\/
 *      }
 *    }
 *
 *  - DELETE an analytics event
 *    curl -X DELETE "https://example.com/api/admin/analytics-events/evt_123" \
 *      -H "Authorization: Bearer <ADMIN_TOKEN>"
 *
 *    Successful response (200):
 *    {
 *      "id": "evt_123",
 *      "object": "analyticsEvent",
 *      "deleted": true
 *    }
 *
 * Notes / Remarks:
 *  - The concrete shape of the analytics event object is defined by the application's analytics model.
 *  - Workflows handle the domain logic; this route layer only adapts HTTP req/res to workflow inputs/outputs.
 *  - Ensure proper admin authentication and permissions when calling these endpoints.
 *
 * @module routes/admin/analytics-events/[id]/route
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { AnalyticsEventUpdate } from "../validators";
import { listAnalyticsEventWorkflow } from "../../../../workflows/analytics/list-analytics-event";
import { updateAnalyticsEventWorkflow } from "../../../../workflows/analytics/update-analytics-event";
import { deleteAnalyticsEventWorkflow } from "../../../../workflows/analytics/delete-analytics-event";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { result } = await listAnalyticsEventWorkflow(req.scope).run({
    input: { filters: { id: [req.params.id] } },
  });
  res.status(200).json({ analyticsEvent: result[0][0] });
};

export const POST = async (req: MedusaRequest<AnalyticsEventUpdate>, res: MedusaResponse) => {
  const { result } = await updateAnalyticsEventWorkflow(req.scope).run({
    input: {
      id: req.params.id,
      ...req.validatedBody,
    },
  });
  res.status(200).json({ analyticsEvent: result });
};

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  await deleteAnalyticsEventWorkflow(req.scope).run({
    input: { id: req.params.id },
  });
  res.status(200).json({
    id: req.params.id,
    object: "analyticsEvent",
    deleted: true,
  });
};
