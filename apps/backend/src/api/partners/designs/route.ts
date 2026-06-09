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
      // Include cancelled runs: production runs are the single source of
      // truth for partner_status, so a cancelled run is how a cancelled
      // assignment is represented (no separate metadata marker).
      filters: { partner_id: partner.id },
      fields: ["id", "design_id", "status", "accepted_at", "started_at", "finished_at", "completed_at", "created_at"],
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

    let partnerStatus: "incoming" | "assigned" | "in_progress" | "awaiting_review" | "finished" | "completed" | "cancelled" =
      "incoming"
    let partnerPhase: "redo" | null = null
    let partnerStartedAt: string | null = null
    let partnerFinishedAt: string | null = null
    let partnerCompletedAt: string | null = null

    // ── Single source of truth: production runs (incl. cancelled) ──────
    const runsForDesign = partnerRuns
      .filter((r: any) => r.design_id === design.id)
      .sort((a: any, b: any) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    const resolvedFromRun = runsForDesign.length > 0
    if (resolvedFromRun) {
      const activeRun = runsForDesign.find(
        (r: any) => !["completed", "cancelled"].includes(String(r.status))
      )
      if (activeRun) {
        const runStatus = String(activeRun.status)
        if (runStatus === "in_progress") {
          partnerStatus = activeRun.finished_at
            ? "awaiting_review"
            : activeRun.started_at
              ? "in_progress"
              : "assigned"
        } else {
          partnerStatus = "assigned"
        }
        if (activeRun.started_at) partnerStartedAt = String(activeRun.started_at)
        if (activeRun.finished_at) partnerFinishedAt = String(activeRun.finished_at)
      } else {
        const newest = runsForDesign[0]
        const runStatus = String(newest.status)
        if (runStatus === "completed") {
          partnerStatus = "completed"
          partnerCompletedAt = newest.completed_at ? String(newest.completed_at) : null
          if (newest.finished_at) partnerFinishedAt = String(newest.finished_at)
        } else if (runStatus === "cancelled") {
          partnerStatus = "cancelled"
        }
      }
    }

    // The legacy v1 fallback (cancel marker + partner-design-* task status
    // inference for run-less designs) was removed 2026-06-09 after the
    // backfill migrated all marked designs onto production runs. A design
    // with no runs is "incoming". See V1_PARTNER_DESIGN_REMOVAL_PLAN.md.

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
