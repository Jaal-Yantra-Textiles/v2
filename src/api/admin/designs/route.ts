
/**
 * Routes for managing Designs in the admin API.
 *
 * This module exports two route handlers:
 * - POST: Create a new Design (authenticated admin only).
 * - GET: List Designs with optional filtering and pagination.
 *
 * Common types & behavior
 * - Authentication:
 *   - POST requires an authenticated admin actor (adminId) via req.auth_context.actor_id.
 *   - GET does not require authentication in this handler (authentication should be enforced by upstream middleware if needed).
 *
 * - Validation:
 *   - POST expects a validated Design payload on req.validatedBody (schema enforced elsewhere via validators).
 *   - POST will set origin_source to "manual" when not provided.
 *
 * - Workflows:
 *   - POST uses createDesignWorkflow(req.scope).run({ input: ... }) to create the design.
 *   - GET uses listDesignsWorkflow(req.scope).run({ input: { pagination, filters } }) to retrieve results.
 *
 * - Refetch:
 *   - After creating a design, POST calls refetchDesign(result.id, req.scope, fields) to reload the created resource before returning it.
 *   - The optional remoteQueryConfig.fields on the request can be used to control which fields are fetched back (defaults to ["*"]).
 *
 * POST (Create new design)
 * @remarks
 * Creates a new design record for an admin actor. Requires req.auth_context.actor_id.
 * The implementation:
 *  - Verifies admin authentication.
 *  - Runs the createDesignWorkflow with the validated body.
 *  - Throws if the workflow returns errors.
 *  - Refetches and returns the created design with HTTP 201 on success.
 *
 * @param req - AuthenticatedMedusaRequest<Design> with:
 *   - req.validatedBody: validated Design input
 *   - optional req.remoteQueryConfig?: { fields?: DesignAllowedFields[] }
 *   - req.auth_context?.actor_id: admin id (required)
 * @param res - MedusaResponse
 *
 * @returns HTTP 201 with JSON { design } on success.
 *
 * @throws HTTP 401 if admin authentication is missing.
 * @throws Workflow errors when createDesignWorkflow returns errors.
 *
 * @example
 * POST /admin/designs
 * Authorization: Bearer <admin-token>
 * Content-Type: application/json
 *
 * Request body (example):
 * {
 *   "title": "Spring Jacket",
 *   "description": "Lightweight spring jacket with contrast stitching",
 *   "design_type": "Original",
 *   "status": "In_Development",
 *   "priority": "High",
 *   "tags": ["outerwear", "spring"],
 *   "target_completion_date": "2026-04-01",
 *   "partner_id": "partner_123"
 * }
 *
 * Successful response (201):
 * {
 *   "design": {
 *     "id": "design_abc123",
 *     "title": "Spring Jacket",
 *     "description": "Lightweight spring jacket with contrast stitching",
 *     "design_type": "Original",
 *     "status": "In_Development",
 *     "priority": "High",
 *     "tags": ["outerwear","spring"],
 *     "origin_source": "manual",
 *     "target_completion_date": "2026-04-01",
 *     "created_at": "2026-01-10T12:00:00.000Z",
 *     "...": "other fields as requested via remoteQueryConfig.fields"
 *   }
 * }
 *
 * GET (List designs)
 * @remarks
 * Returns a paginated list of designs with optional filter criteria. The handler:
 *  - Builds pagination parameters from req.query.offset and req.query.limit (defaults: offset=0, limit=10).
 *  - Accepts multiple filters via the query string (see @param filter list).
 *  - Calls listDesignsWorkflow and returns designs, count and echo of pagination parameters.
 *
 * Supported query parameters (via req.query):
 *  - offset?: number - result offset (default 0)
 *  - limit?: number - page size (default 10)
 *  - name?: string - partial or full name match
 *  - design_type?: "Original" | "Derivative" | "Custom" | "Collaboration"
 *  - status?: "Conceptual" | "In_Development" | "Technical_Review" | "Sample_Production" | "Revision" | "Approved" | "Rejected" | "On_Hold"
 *  - priority?: "Low" | "Medium" | "High" | "Urgent"
 *  - tags?: string[] - array of tag strings to filter by
 *  - partner_id?: string - filter by partner id
 *  - created_at?: DateComparisonOperator - object with date comparison (e.g. { gt: "2026-01-01" })
 *  - target_completion_date?: DateComparisonOperator - same semantics as created_at
 *
 * Response:
 *  - 200: { designs: Design[], count: number, offset: number, limit: number }
 *  - 400: { error: string } on malformed input or workflow/handler errors
 *
 * @param req - MedusaRequest with typed query parameters described above.
 * @param res - MedusaResponse
 *
 * @example
 * GET /admin/designs?offset=0&limit=5&status=In_Development&tags[]=outerwear
 *
 * Successful response (200):
 * {
 *   "designs": [
 *     {
 *       "id": "design_abc123",
 *       "title": "Spring Jacket",
 *       "status": "In_Development",
 *       "priority": "High",
 *       "tags": ["outerwear","spring"],
 *       "created_at": "2026-01-10T12:00:00.000Z"
 *     },
 *     {
 *       "id": "design_def456",
 *       "title": "Light Hoodie",
 *       "status": "In_Development",
 *       "priority": "Medium",
 *       "tags": ["outerwear"],
 *       "created_at": "2026-01-08T09:00:00.000Z"
 *     }
 *   ],
 *   "count": 12,
 *   "offset": 0,
 *   "limit": 5
 * }
 *
 * Error handling
 * - Workflow errors are logged via console.warn and then thrown (POST) or cause a 400 response (GET).
 * - GET wraps workflow invocation in try/catch and returns 400 with error.message on failure.
 *
 * See also
 * - createDesignWorkflow: handles business logic for creating a design.
 * - listDesignsWorkflow: handles listing, filtering and pagination logic.
 * - refetchDesign: utility to reload a design resource with selected fields after creation.
 */
import {
  AuthenticatedMedusaRequest,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";

import { Design } from "./validators";
import createDesignWorkflow from "../../../workflows/designs/create-design";
import listDesignsWorkflow from "../../../workflows/designs/list-designs";
import { DesignAllowedFields, refetchDesign } from "./helpers";
import { DateComparisonOperator } from "@medusajs/types";

// Create new design
export const POST = async (
  req: AuthenticatedMedusaRequest<Design> & {
    remoteQueryConfig?: {
      fields?: DesignAllowedFields[];
    };
  },
  res: MedusaResponse,
) => {
  

  const { result, errors } = await createDesignWorkflow(req.scope).run({
    input: {
      ...req.validatedBody,
      origin_source: req.validatedBody?.origin_source ?? "manual",
    },
  })

  if (errors.length > 0) {
    console.warn("Error reported at", errors);
    throw errors;
  }

  const design = await refetchDesign(
    result.id,
    req.scope,
    req.remoteQueryConfig?.fields || ["*"],
  );

  res.status(201).json({ design });
};

// List all designs
export const GET = async (
  req: MedusaRequest & {
    query: {
      offset?: number;
      limit?: number;
      name?: string;
      design_type?: "Original" | "Derivative" | "Custom" | "Collaboration";
      status?: "Conceptual" | "In_Development" | "Technical_Review" | "Sample_Production" | "Revision" | "Approved" | "Rejected" | "On_Hold";
      priority?: "Low" | "Medium" | "High" | "Urgent";
      tags?: string[];
      partner_id?: string;
      created_at?: DateComparisonOperator;
      target_completion_date?: DateComparisonOperator;
    };
  },
  res: MedusaResponse
) => {

  try {
    const { result, errors } = await listDesignsWorkflow(req.scope).run({
      input: {
        pagination: {
          offset: Number(req.query.offset) || 0,
          limit: Number(req.query.limit) || 10,
        },
        filters: {
          name: req.query.name,
          design_type: req.query.design_type,
          status: req.query.status,
          priority: req.query.priority,
          tags: req.query.tags,
          partner_id: req.query.partner_id,
          created_at: req.query.created_at,
          target_completion_date: req.query.target_completion_date,
        },
      },
    });

  

    if (errors.length > 0) {
      console.warn("Error reported at", errors);
      throw errors;
    }

    const { designs, count } = result;

    res.status(200).json({
      designs,
      count,
      offset: req.query.offset || 0,
      limit: req.query.limit || 10,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
