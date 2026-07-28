import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  transform,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import designPartnersLink from "../../links/design-partners-link"
import {
  applyDesignListFilters,
  type DesignBucket,
} from "../../api/partners/designs/list-filters"

// #843 — the partner designs listing, lifted out of `GET /partners/designs`
// into a workflow so the admin inspection mirror (`GET /admin/partners/:id/
// designs`) can run the *same* logic instead of re-deriving it. Re-deriving is
// how two surfaces drift; the mirror is only useful if it cannot lie.
//
// The route keeps auth (resolve the partner from the bearer) and hands the rest
// here. The admin proxy resolves the partner from `:id` and calls the same
// workflow — that is the entire difference between the two surfaces.

export type ListPartnerDesignsWorkflowInput = {
  partnerId: string
  q?: string
  status?: string
  bucket?: DesignBucket
  offset: number
  limit: number
  /** Forwarded to `query.graph` for translated fields; the route reads it off the request. */
  locale?: string
}

/**
 * The partner-scoped design set: every design LINKED to the partner, plus every
 * design the partner OWNS, deduped and sorted newest-first.
 *
 * Pagination is deliberately NOT applied here. `query.graph` cannot filter on
 * the linked design's own columns (`design.status`) and the partner route has no
 * free-text index, so status/`q` are matched in-app downstream. Slicing here
 * would cut BEFORE the merge and those filters run, returning the wrong page and
 * a per-page (not total) count — the #484 page-vs-set bug.
 */
export const resolvePartnerDesignRowsStep = createStep(
  "resolve-partner-design-rows",
  async (
    input: { partnerId: string; locale?: string },
    { container }
  ) => {
    const { partnerId, locale } = input
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

    // Order newest-assigned first: the link row's `created_at` is when the
    // design was assigned to (or created by) this partner. Without an explicit
    // order the link query returns rows in an arbitrary order, so a freshly
    // assigned design could fall past the `take` window and never reach page 1.
    // Wrapped in a fallback so that if a runtime ever rejects `order` on a link
    // entry point, the listing degrades to unordered instead of 500-ing.
    const linkFields = ["created_at", "design.*", "design.tasks.*", "partner.*"]
    let linkRows: any[] = []
    try {
      const { data } = await query.graph(
        {
          entity: designPartnersLink.entryPoint,
          fields: linkFields,
          filters: { partner_id: partnerId },
          pagination: { skip: 0, take: 1000, order: { created_at: "DESC" } },
        },
        { locale }
      )
      linkRows = data
    } catch {
      const { data } = await query.graph(
        {
          entity: designPartnersLink.entryPoint,
          fields: linkFields,
          filters: { partner_id: partnerId },
          pagination: { skip: 0, take: 1000 },
        },
        { locale }
      )
      linkRows = data
    }

    // Guard against orphaned link rows: a soft-deleted design resolves to a null
    // `design` on the link join (e.g. after DELETE /partners/designs/:id), and
    // the mapping downstream dereferences `design.*` — drop those so the listing
    // doesn't 500.
    const allLinked = (linkRows || [])
      .filter((row: any) => !!row?.design)
      .map((row: any) => ({
        ...row,
        _recency: row.created_at || row.design?.created_at || null,
      }))

    // Safety net: also pull designs this partner OWNS (created via self-serve).
    // They ARE in the link table (POST creates the link), so the ordered query
    // above already surfaces them — but if link ordering ever misses one, this
    // guarantees a partner still sees what they created. Merged + re-sorted by
    // recency below, never force-pinned. Always fetched (no offset gate):
    // pagination happens downstream AFTER the merge, so gating this on
    // offset === 0 would drop owned designs from every page but the first. #484.
    let ownedRows: any[] = []
    try {
      const { data: owned } = await query.graph(
        {
          entity: "design",
          filters: { owner_partner_id: partnerId } as any,
          fields: ["*", "tasks.*"],
          pagination: { skip: 0, take: 50, order: { created_at: "DESC" } },
        },
        { locale }
      )
      ownedRows = (owned || [])
        .filter((d: any) => !!d?.id)
        .map((d: any) => ({
          design: d,
          partner: { id: partnerId },
          _recency: d.created_at || null,
        }))
    } catch {
      // Non-fatal — owned designs still appear via the linked set.
    }

    // Merge linked + owned, deduped by design id, then sort newest-first so the
    // most recently assigned/created design is always on top.
    const seen = new Set<string>()
    const merged: any[] = []
    for (const item of [...allLinked, ...ownedRows]) {
      const designId = item?.design?.id
      if (!designId || seen.has(designId)) {
        continue
      }
      seen.add(designId)
      merged.push(item)
    }
    merged.sort((a: any, b: any) => {
      const at = a._recency ? new Date(a._recency).getTime() : 0
      const bt = b._recency ? new Date(b._recency).getTime() : 0
      return bt - at
    })

    return new StepResponse(merged)
  }
)

/**
 * Every production run belonging to the partner, in one read rather than one
 * per design. Production runs are the single source of truth for
 * `partner_status`, so cancelled runs are included — a cancelled run is how a
 * cancelled assignment is represented (there is no separate metadata marker).
 */
export const resolvePartnerDesignRunsStep = createStep(
  "resolve-partner-design-runs",
  async (
    input: { partnerId: string; locale?: string },
    { container }
  ) => {
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    try {
      const { data: runs } = await query.graph(
        {
          entity: "production_runs",
          filters: { partner_id: input.partnerId },
          fields: [
            "id",
            "design_id",
            "status",
            "accepted_at",
            "started_at",
            "finished_at",
            "completed_at",
            "created_at",
          ],
          pagination: { skip: 0, take: 200 },
        },
        { locale: input.locale }
      )
      return new StepResponse(runs || [])
    } catch {
      // Non-fatal: a design with no resolvable runs reads as "incoming".
      return new StepResponse([] as any[])
    }
  }
)

/**
 * Derive the partner-facing view of one design from its production runs.
 *
 * The legacy v1 fallback (cancel marker + `partner-design-*` task-status
 * inference for run-less designs) was removed 2026-06-09 after the backfill
 * migrated all marked designs onto production runs. A design with no runs is
 * "incoming". See V1_PARTNER_DESIGN_REMOVAL_PLAN.md.
 */
const buildPartnerDesignView = (
  linkData: any,
  partnerId: string,
  partnerRuns: any[]
) => {
  const design = linkData.design

  const tasks = design.tasks || []
  const isPartnerWorkflowTask = (t: any) =>
    !!t &&
    [
      "partner-design-start",
      "partner-design-redo",
      "partner-design-finish",
      "partner-design-completed",
    ].includes(t.title)
  const workflowTasks = tasks.filter(isPartnerWorkflowTask)

  let partnerStatus:
    | "incoming"
    | "assigned"
    | "in_progress"
    | "awaiting_review"
    | "finished"
    | "completed"
    | "cancelled" = "incoming"
  const partnerPhase: "redo" | null = null
  let partnerStartedAt: string | null = null
  let partnerFinishedAt: string | null = null
  let partnerCompletedAt: string | null = null

  const runsForDesign = partnerRuns
    .filter((r: any) => r.design_id === design.id)
    .sort(
      (a: any, b: any) =>
        new Date(b.created_at || 0).getTime() -
        new Date(a.created_at || 0).getTime()
    )

  if (runsForDesign.length > 0) {
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
        partnerCompletedAt = newest.completed_at
          ? String(newest.completed_at)
          : null
        if (newest.finished_at) partnerFinishedAt = String(newest.finished_at)
      } else if (runStatus === "cancelled") {
        partnerStatus = "cancelled"
      }
    }
  }

  return {
    ...design,
    partner_info: {
      assigned_partner_id: linkData.partner?.id || partnerId,
      partner_status: partnerStatus,
      partner_phase: partnerPhase,
      partner_started_at: partnerStartedAt,
      partner_finished_at: partnerFinishedAt,
      partner_completed_at: partnerCompletedAt,
      workflow_tasks_count: workflowTasks.length,
    },
    // Whether the partner in scope OWNS this design (vs merely being assigned
    // to it). A bare truthiness check on `owner_partner_id` would mislabel a
    // design owned by another partner but assigned to this one — #920.
    is_owner:
      design.owner_partner_id != null &&
      design.owner_partner_id === partnerId,
  }
}

export const listPartnerDesignsWorkflow = createWorkflow(
  "list-partner-designs",
  (input: ListPartnerDesignsWorkflowInput) => {
    const rows = resolvePartnerDesignRowsStep({
      partnerId: input.partnerId,
      locale: input.locale,
    })

    const partnerRuns = resolvePartnerDesignRunsStep({
      partnerId: input.partnerId,
      locale: input.locale,
    })

    // status + free-text (`q`) filtering runs AFTER the mapping (so `q` can
    // match the resolved design fields), THEN paginates — over the full
    // partner-scoped set, so `count` is the total matched and the UI pager is
    // correct. `applyDesignListFilters` is pure and unit-tested.
    const output = transform(
      { rows, partnerRuns, input },
      ({ rows, partnerRuns, input }) => {
        const mapped = (rows as any[]).map((row) =>
          buildPartnerDesignView(row, input.partnerId, partnerRuns as any[])
        )

        const { items, count, facets } = applyDesignListFilters(mapped, {
          q: input.q,
          status: input.status,
          bucket: input.bucket,
          offset: input.offset,
          limit: input.limit,
        })

        return {
          designs: items,
          count,
          // #6 — per-bucket counts for the partner work tabs (accurate across
          // all pages, computed over the full q+status set before the active
          // bucket).
          facets,
          limit: input.limit,
          offset: input.offset,
        }
      }
    )

    return new WorkflowResponse(output)
  }
)
