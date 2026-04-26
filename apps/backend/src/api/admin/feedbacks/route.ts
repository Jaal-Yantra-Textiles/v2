
/**
 * @module AdminFeedbacksRoute
 *
 * API route for managing feedback entries in the admin scope.
 *
 * Exposes two handlers:
 * - GET: list feedbacks with filtering, paging and optional relation inclusion
 * - POST: create a new feedback entry
 *
 * @remarks
 * GET accepts query parameters for paging, filtering, and including related entities:
 * - offset (number, default 0): zero-based skip / offset for pagination
 * - limit  (number, default 20): number of items to return
 * - rating (one | two | three | four | five): filter by rating
 * - status (pending | reviewed | resolved): filter by feedback status
 * - submitted_by (string): filter by submitter id
 * - reviewed_by (string): filter by reviewer id
 * - include_partners (string "true"|"false"): include linked partners
 * - include_tasks (string "true"|"false"): include linked tasks
 * - include_inventory_orders (string "true"|"false"): include linked inventory orders
 *
 * GET response shape:
 * {
 *   feedbacks: Array<any>, // list of feedback DTOs (may include requested relations)
 *   count: number,         // total matching items
 *   offset: number,
 *   limit: number
 * }
 *
 * POST expects a validated Feedback payload (see Feedback validator in codebase) and returns
 * the created feedback object.
 *
 * POST response (201):
 * {
 *   feedback: any // created feedback DTO
 * }
 *
 * Error handling: standard HTTP error codes are used for validation/authentication/processing errors.
 *
 * @example
 * // List feedbacks (curl)
 * // - returns first 20 feedbacks with related partners and tasks included
 * curl -X GET "https://api.example.com/admin/feedbacks?offset=0&limit=20&include_partners=true&include_tasks=true" \
 *   -H "Authorization: Bearer <ADMIN_TOKEN>"
 *
 * // Example successful GET response (200)
 * // {
 * //   "feedbacks": [{ "id": "fb_123", "rating": "five", "status": "pending", ... }],
 * //   "count": 137,
 * //   "offset": 0,
 * //   "limit": 20
 * // }
 *
 * @example
 * // Create feedback (curl)
 * curl -X POST "https://api.example.com/admin/feedbacks" \
 *   -H "Content-Type: application/json" \
 *   -H "Authorization: Bearer <ADMIN_TOKEN>" \
 *   -d '{
 *     "title": "Inventory issue",
 *     "description": "Description of the issue...",
 *     "rating": "three",
 *     "submitted_by": "user_abc",
 *     "metadata": { "store": "north" }
 *   }'
 *
 * // Example successful POST response (201)
 * // {
 * //   "feedback": {
 * //     "id": "fb_456",
 * //     "title": "Inventory issue",
 * //     "description": "Description of the issue...",
 * //     "rating": "three",
 * //     "status": "pending",
 * //     "submitted_by": "user_abc",
 * //     "created_at": "2024-01-01T12:00:00Z",
 * //     ...
 * //   }
 * // }
 *
 * @param req - MedusaRequest with validated query/body depending on method
 * @param res - MedusaResponse used to send JSON responses and HTTP status codes
 *
 * @see Feedback validator for allowed POST payload fields and validation rules
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { Feedback } from "./validators";
import { createFeedbackWorkflow } from "../../../workflows/feedback/create-feedback";
import { listFeedbackWorkflow } from "../../../workflows/feedback/list-feedback";

export const GET = async (
  req: MedusaRequest & {
    query?: {
      offset?: number;
      limit?: number;
      rating?: "one" | "two" | "three" | "four" | "five";
      status?: "pending" | "reviewed" | "resolved";
      submitted_by?: string;
      reviewed_by?: string;
      include_partners?: string;
      include_tasks?: string;
      include_inventory_orders?: string;
    };
  },
  res: MedusaResponse
) => {
  const offset = Number(req.query?.offset ?? 0);
  const limit = Number(req.query?.limit ?? 20);

  // Parse include flags
  const includePartners = req.query?.include_partners === "true";
  const includeTasks = req.query?.include_tasks === "true";
  const includeInventoryOrders = req.query?.include_inventory_orders === "true";

  const { result } = await listFeedbackWorkflow(req.scope).run({
    input: {
      filters: {
        rating: req.query?.rating,
        status: req.query?.status,
        submitted_by: req.query?.submitted_by,
        reviewed_by: req.query?.reviewed_by,
      },
      config: {
        skip: offset,
        take: limit,
      },
      includeLinks: {
        partners: includePartners,
        tasks: includeTasks,
        inventoryOrders: includeInventoryOrders,
      },
    },
  });

  const feedbacks = result[0] || [];
  const count = result[1] || 0;

  res.status(200).json({
    feedbacks,
    count,
    offset,
    limit,
  });
};

export const POST = async (req: MedusaRequest<Feedback>, res: MedusaResponse) => {
  const { result } = await createFeedbackWorkflow(req.scope).run({
    input: req.validatedBody,
  });
  res.status(201).json({ feedback: result });
};
