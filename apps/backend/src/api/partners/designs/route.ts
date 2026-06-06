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
import designPartnersLink from "../../../links/design-partners-link"
import { createDesignWorkflow } from "../../../workflows/designs/create-design"
import { linkDesignPartnerWorkflow } from "../../../workflows/designs/partner/link-design-to-partner"

export async function GET(
  req: AuthenticatedMedusaRequest<ListDesignsQuery>,
  res: MedusaResponse
) {
  const { limit = 20, offset = 0, status } = req.validatedQuery

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Authenticated partner
  if (!req.auth_context?.actor_id) {
    return res.status(401).json({ error: "Partner authentication required - no actor ID" })
  }
  
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    return res.status(401).json({ error: "Partner authentication required - no partner found" })
  }

  // Filters: cannot filter on linked design properties; filter post-query if needed
  const filters: any = { partner_id: partner.id }

  // Order newest-assigned first: the link row's `created_at` is when the
  // design was assigned to (or created by) this partner. Without an
  // explicit order the link query returns rows in an arbitrary order, so
  // a freshly assigned/created design could fall past the `take` window
  // and never reach page 1. Wrapped in a fallback so that if a runtime
  // ever rejects `order` on a link entry point, the listing degrades to
  // unordered instead of 500-ing.
  const linkFields = ["created_at", "design.*", "design.tasks.*", "partner.*"]
  let results: any[] = []
  try {
    const { data } = await query.graph({
      entity: designPartnersLink.entryPoint,
      fields: linkFields,
      filters,
      pagination: { skip: offset, take: limit, order: { created_at: "DESC" } },
    }, { locale: req.locale })
    results = data
  } catch {
    const { data } = await query.graph({
      entity: designPartnersLink.entryPoint,
      fields: linkFields,
      filters,
      pagination: { skip: offset, take: limit },
    }, { locale: req.locale })
    results = data
  }

  // Include all linked designs for this partner.
  // We'll compute assignment status based on presence of partner workflow tasks (by known titles).
  // Guard against orphaned link rows: a soft-deleted design resolves to
  // a null `design` on the link join (e.g. after DELETE /partners/designs/:id),
  // and the mapping below dereferences `design.*` — drop those so the
  // listing doesn't 500.
  const allLinked = (results || [])
    .filter((linkData: any) => !!linkData?.design)
    .map((l: any) => ({
      ...l,
      _recency: l.created_at || l.design?.created_at || null,
    }))

  // Safety net: also pull designs this partner OWNS (created via
  // self-serve). They ARE in the link table (POST creates the link), so
  // the ordered query above already surfaces them — but if link ordering
  // ever misses one, this guarantees a partner still sees what they
  // created. Merged + re-sorted by recency below, never force-pinned.
  let ownedRows: any[] = []
  if (offset === 0) {
    try {
      const { data: owned } = await query.graph(
        {
          entity: "design",
          filters: { owner_partner_id: partner.id } as any,
          fields: ["*", "tasks.*"],
          pagination: { skip: 0, take: 50, order: { created_at: "DESC" } },
        },
        { locale: req.locale }
      )
      // Normalize to the {design, partner} shape the mapping below expects.
      ownedRows = (owned || [])
        .filter((d: any) => !!d?.id)
        .map((d: any) => ({
          design: d,
          partner,
          _recency: d.created_at || null,
        }))
    } catch {
      // Non-fatal — owned designs still appear via the linked set.
    }
  }

  // Merge linked + owned, deduped by design id, then sort newest-first by
  // recency so the most recently assigned/created design is always on top.
  const seenDesignIds = new Set<string>()
  const merged: any[] = []
  for (const item of [...allLinked, ...ownedRows]) {
    const did = item?.design?.id
    if (!did || seenDesignIds.has(did)) {
      continue
    }
    seenDesignIds.add(did)
    merged.push(item)
  }
  merged.sort((a: any, b: any) => {
    const at = a._recency ? new Date(a._recency).getTime() : 0
    const bt = b._recency ? new Date(b._recency).getTime() : 0
    return bt - at
  })

  // post-filter by design.status if requested
  let filtered = merged
  if (status) {
    filtered = merged.filter((linkData: any) => linkData.design?.status === status)
  }

  // Pre-fetch all production runs for this partner (one query, not per-design)
  let partnerRuns: any[] = []
  try {
    const { data: runs } = await query.graph({
      entity: "production_runs",
      filters: {
        partner_id: partner.id,
        status: { $nin: ["cancelled"] },
      },
      fields: ["id", "design_id", "status", "accepted_at", "started_at", "finished_at", "completed_at"],
      pagination: { skip: 0, take: 200 },
    }, { locale: req.locale })
    partnerRuns = runs || []
  } catch {
    // Non-fatal
  }

  const designs = filtered.map((linkData: any) => {
    const design = linkData.design

    const tasks = design.tasks || []
    const isPartnerWorkflowTask = (t: any) =>
      !!t && [
        "partner-design-start",
        "partner-design-redo",
        "partner-design-finish",
        "partner-design-completed",
      ].includes(t.title)
    const workflowTasks = tasks.filter(isPartnerWorkflowTask)

    // Check if assignment was cancelled
    const wasCancelled = !!design?.metadata?.partner_assignment_cancelled_at

    // Derive from metadata first (authoritative), then fall back to task-based inference
    let partnerStatus: "incoming" | "assigned" | "in_progress" | "finished" | "completed" | "cancelled" =
      wasCancelled ? "cancelled" : ((design?.metadata?.partner_status as any) || "incoming")
    let partnerPhase: "redo" | null = (design?.metadata?.partner_phase as any) || null
    let partnerStartedAt: string | null = (design?.metadata?.partner_started_at as any) || null
    let partnerFinishedAt: string | null = (design?.metadata?.partner_finished_at as any) || null
    let partnerCompletedAt: string | null = (design?.metadata?.partner_completed_at as any) || null

    // If redo phase is flagged in metadata, reflect in-progress immediately (deterministic)
    if (partnerPhase === "redo" && !wasCancelled) {
      partnerStatus = "in_progress"
    }

    if (workflowTasks.length > 0) {
      // start -> redo (optional) -> finish -> completed
      const startTask = workflowTasks.find((t: any) => t.title === "partner-design-start" && t.status === "completed")
      const redoTask = workflowTasks.find((t: any) => t.title === "partner-design-redo" && t.status === "completed")
      const finishTask = workflowTasks.find((t: any) => t.title === "partner-design-finish" && t.status === "completed")
      const completedTask = workflowTasks.find((t: any) => t.title === "partner-design-completed" && t.status === "completed")

      // If metadata didn't set a terminal state, infer from tasks
      if (!partnerStatus || partnerStatus === "incoming" || partnerStatus === "assigned") {
        partnerStatus = "assigned"
        if (completedTask) {
          partnerStatus = "completed"
          partnerCompletedAt = partnerCompletedAt || (completedTask.updated_at ? String(completedTask.updated_at) : null)
        } else if (redoTask) {
          // Prefer redo state whenever redo task is completed, regardless of timestamp ordering vs finish
          partnerStatus = "in_progress"
          partnerPhase = "redo"
        } else if (finishTask) {
          partnerStatus = "finished"
          partnerFinishedAt = partnerFinishedAt || (finishTask.updated_at ? String(finishTask.updated_at) : null)
        } else if (startTask) {
          partnerStatus = "in_progress"
          partnerStartedAt = partnerStartedAt || (startTask.updated_at ? String(startTask.updated_at) : null)
        }
      }
    }

    // Final safeguard: if phase is redo, ensure status reflects in-progress
    if (partnerPhase === "redo") {
      partnerStatus = "in_progress"
    }

    // Override with production run status if a run exists for this partner + design
    // Prefer the most recent non-terminal (not completed) run; fall back to most recent overall
    const runsForDesign = partnerRuns
      .filter((r: any) => r.design_id === design.id)
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    const activeRun = runsForDesign.find((r: any) => !["completed", "cancelled"].includes(r.status)) || runsForDesign[0]
    if (activeRun) {
      const runStatus = String(activeRun.status)
      if (runStatus === "sent_to_partner") {
        partnerStatus = "assigned"
      } else if (runStatus === "in_progress") {
        if (activeRun.finished_at) {
          // Partner marked finished, waiting for admin to review and complete
          partnerStatus = "awaiting_review" as any
          partnerFinishedAt = partnerFinishedAt || String(activeRun.finished_at)
        } else if (activeRun.started_at) {
          partnerStatus = "in_progress"
          partnerStartedAt = partnerStartedAt || String(activeRun.started_at)
        } else {
          partnerStatus = "assigned"
        }
      } else if (runStatus === "completed") {
        partnerStatus = "completed"
        partnerCompletedAt = partnerCompletedAt || String(activeRun.completed_at)
      }
      if (activeRun.finished_at) partnerFinishedAt = partnerFinishedAt || String(activeRun.finished_at)
    }

    const partner_info = {
      assigned_partner_id: linkData.partner?.id || partner.id,
      partner_status: partnerStatus,
      partner_phase: partnerPhase,
      partner_started_at: partnerStartedAt,
      partner_finished_at: partnerFinishedAt,
      partner_completed_at: partnerCompletedAt,
      workflow_tasks_count: workflowTasks.length,
    }

    return {
      ...design,
      partner_info,
    }
  })

  res.status(200).json({
    designs,
    count: designs.length,
    limit,
    offset,
  })
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
