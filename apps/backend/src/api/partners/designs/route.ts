/**
 * @file Partner Designs API routes
 * @description Provides endpoints for retrieving design information associated with a partner in the JYT Commerce platform
 * @module API/Partners/Designs
 */

/**
 * @typedef {Object} ListDesignsQuery
 * @property {number} [limit=20] - Number of designs to return (default: 20)
 * @property {number} [offset=0] - Pagination offset (default: 0)
 * @property {string} [status] - Filter designs by status (e.g., "active", "inactive")
 */

/**
 * @typedef {Object} DesignTask
 * @property {string} id - The unique identifier for the task
 * @property {string} title - The title of the task
 * @property {string} status - The status of the task (e.g., "completed", "pending")
 * @property {Date} updated_at - When the task was last updated
 */

/**
 * @typedef {Object} Design
 * @property {string} id - The unique identifier for the design
 * @property {string} status - The status of the design
 * @property {DesignTask[]} tasks - List of tasks associated with the design
 * @property {Object} metadata - Additional metadata for the design
 * @property {string} metadata.partner_status - The partner status of the design
 * @property {string} metadata.partner_phase - The partner phase of the design
 * @property {string} metadata.partner_started_at - When the partner started working on the design
 * @property {string} metadata.partner_finished_at - When the partner finished working on the design
 * @property {string} metadata.partner_completed_at - When the partner completed the design
 */

/**
 * @typedef {Object} PartnerInfo
 * @property {string} assigned_partner_id - The ID of the assigned partner
 * @property {"incoming"|"assigned"|"in_progress"|"finished"|"completed"} partner_status - The status of the design from the partner's perspective
 * @property {"redo"|null} partner_phase - The current phase of the design
 * @property {string|null} partner_started_at - When the partner started working on the design
 * @property {string|null} partner_finished_at - When the partner finished working on the design
 * @property {string|null} partner_completed_at - When the partner completed the design
 * @property {number} workflow_tasks_count - The number of workflow tasks associated with the design
 */

/**
 * @typedef {Object} DesignResponse
 * @property {string} id - The unique identifier for the design
 * @property {string} status - The status of the design
 * @property {DesignTask[]} tasks - List of tasks associated with the design
 * @property {PartnerInfo} partner_info - Information about the partner's interaction with the design
 */

/**
 * @typedef {Object} ListDesignsResponse
 * @property {DesignResponse[]} designs - List of designs
 * @property {number} count - Total number of designs returned
 * @property {number} limit - Number of designs per page
 * @property {number} offset - Pagination offset
 */

/**
 * List designs associated with a partner
 * @route GET /partners/designs
 * @group Partner Designs - Operations related to partner designs
 * @param {number} [offset=0] - Pagination offset
 * @param {number} [limit=20] - Number of designs to return
 * @param {string} [status] - Filter designs by status
 * @returns {ListDesignsResponse} 200 - Paginated list of designs associated with the partner
 * @throws {MedusaError} 401 - Partner authentication required - no actor ID
 * @throws {MedusaError} 401 - Partner authentication required - no partner found
 *
 * @example request
 * GET /partners/designs?offset=0&limit=10&status=active
 *
 * @example response 200
 * {
 *   "designs": [
 *     {
 *       "id": "design_123456789",
 *       "status": "active",
 *       "tasks": [
 *         {
 *           "id": "task_123456789",
 *           "title": "partner-design-start",
 *           "status": "completed",
 *           "updated_at": "2023-01-01T00:00:00Z"
 *         }
 *       ],
 *       "partner_info": {
 *         "assigned_partner_id": "partner_123456789",
 *         "partner_status": "in_progress",
 *         "partner_phase": null,
 *         "partner_started_at": "2023-01-01T00:00:00Z",
 *         "partner_finished_at": null,
 *         "partner_completed_at": null,
 *         "workflow_tasks_count": 1
 *       }
 *     }
 *   ],
 *   "count": 1,
 *   "limit": 10,
 *   "offset": 0
 * }
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../helpers"
import { ListDesignsQuery, PartnerCreateDesign } from "./validators"
import { listPartnerDesignsWorkflow } from "../../../workflows/designs/list-partner-designs"
import { createDesignWorkflow } from "../../../workflows/designs/create-design"
import { linkDesignPartnerWorkflow } from "../../../workflows/designs/partner/link-design-to-partner"

export async function GET(
  req: AuthenticatedMedusaRequest<ListDesignsQuery>,
  res: MedusaResponse
) {
  const { limit = 20, offset = 0, status, q, bucket } =
    req.validatedQuery as ListDesignsQuery

  // Authenticated partner
  if (!req.auth_context?.actor_id) {
    return res.status(401).json({ error: "Partner authentication required - no actor ID" })
  }

  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    return res.status(401).json({ error: "Partner authentication required - no partner found" })
  }

  // The listing itself lives in a workflow so the admin inspection mirror
  // (`GET /admin/partners/:id/designs`, #843) runs exactly this logic rather
  // than a second copy of it. This route contributes auth and nothing else.
  const { result } = await listPartnerDesignsWorkflow(req.scope).run({
    input: {
      partnerId: partner.id,
      q,
      status,
      bucket,
      offset,
      limit,
      locale: req.locale,
    },
  })

  res.status(200).json(result)
}

/**
 * Create a design owned by the authenticated partner.
 * @route POST /partners/designs
 *
 * Roadmap #6 (partner design self-serve). Mirrors `POST /admin/designs`
 * but stamps `owner_partner_id` from the authenticated partner (so the
 * design is excluded from the global admin list by default) and links
 * the design to the partner via `design_partners_link` (so it surfaces
 * in this same partner's `GET /partners/designs`). The partner cannot
 * forge ownership — `owner_partner_id` is taken from auth, never the
 * body.
 */
export async function POST(
  req: AuthenticatedMedusaRequest<PartnerCreateDesign>,
  res: MedusaResponse
) {
  if (!req.auth_context?.actor_id) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "Partner authentication required - no actor ID"
    )
  }
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "Partner authentication required - no partner found"
    )
  }

  const body = req.validatedBody

  const { result } = await createDesignWorkflow(req.scope).run({
    input: {
      ...body,
      // `Design.description` is a non-nullable text column — default to
      // empty string when the partner omits it so the create doesn't
      // 500 on a ValidationError.
      description: body.description ?? "",
      origin_source: "manual",
      owner_partner_id: partner.id,
    } as any,
  })

  // Link the new design to the creating partner so it appears in their
  // own listing + detail. Idempotent on the (design, partner) pair.
  await linkDesignPartnerWorkflow(req.scope).run({
    input: {
      design_id: result.id,
      partner_ids: [partner.id],
    },
  })

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: refetched } = await query.graph(
    {
      entity: "design",
      filters: { id: result.id },
      fields: ["*", "colors.*", "size_sets.*"],
    },
    { locale: req.locale }
  )

  res.status(201).json({ design: refetched?.[0] ?? result })
}
