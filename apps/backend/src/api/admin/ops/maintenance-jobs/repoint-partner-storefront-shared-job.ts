import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { PARTNER_MODULE } from "../../../../modules/partner"
import type {
  MaintenanceChange,
  MaintenanceJob,
  MaintenanceJobResult,
} from "./registry"

/**
 * Storefront thin-down tail — repoint partners onto the SHARED multi-tenant
 * Vercel project after their domain has been cut over (scripts/thin-down-vercel-
 * storefronts.mjs). The domain move is what makes the storefront render; THIS job
 * flips the partner's stored columns so the partner dashboard / admin "which
 * project" reads and future domain ops target the shared project instead of the
 * now-idle per-partner project:
 *   - deployment_project_id     → shared_project_id
 *   - deployment_project_name   → shared_project_name
 *   - vercel_project_id         → shared_project_id   (kept in sync for legacy reads)
 *   - vercel_project_name       → shared_project_name
 *   - hosting_provider          → "vercel" (unchanged; asserted)
 *
 * Run this ONLY after the domain cutover for that partner has verified + renders
 * — it's pure bookkeeping and does NOT touch Vercel/DNS. Idempotent: a partner
 * already pointing at the shared project is skipped. Scope to one partner with
 * partner_id, or migrate the whole set. Dry-run lists who WOULD be repointed.
 */

export const MAX_REPOINT_SCAN = 5000

const paramsSchema = z.object({
  /** The shared Vercel project id (VERCEL_SHARED_PROJECT_ID). */
  shared_project_id: z.string().min(1),
  /** The shared project's name (default "storefront-shared"). */
  shared_project_name: z.string().min(1).optional().default("storefront-shared"),
  /** Restrict to a single partner. */
  partner_id: z.string().min(1).optional(),
  limit: z.number().int().positive().max(MAX_REPOINT_SCAN).optional().default(1000),
})

export type RepointAction = "already_shared" | "not_vercel" | "not_provisioned" | "repoint"

/**
 * PURE: decide what to do for one partner. Exported for unit testing.
 *   - not a Vercel partner                              → not_vercel (skip)
 *   - no project ref at all                             → not_provisioned (skip)
 *   - already on the shared project                     → already_shared (skip)
 *   - otherwise                                         → repoint
 */
export function decideRepointAction(
  partner: {
    hosting_provider?: string | null
    deployment_project_id?: string | null
    vercel_project_id?: string | null
  },
  sharedProjectId: string
): RepointAction {
  const provider = partner?.hosting_provider ?? "vercel" // pre-#884 null => vercel
  if (provider !== "vercel") return "not_vercel"

  const current = partner?.deployment_project_id ?? partner?.vercel_project_id
  if (!current) return "not_provisioned"
  if (current === sharedProjectId) return "already_shared"
  return "repoint"
}

export const repointPartnerStorefrontSharedJob: MaintenanceJob = {
  id: "repoint-partner-storefront-shared",
  label: "Repoint partner storefront → shared Vercel project",
  description:
    `Storefront thin-down bookkeeping: after a partner's *.cicilabel.com domain is cut over to the shared multi-tenant Vercel project (scripts/thin-down-vercel-storefronts.mjs), stamp the partner's stored columns (deployment_project_id/name + vercel_project_id/name) to the shared project so the dashboard/admin reads and future ops target it. Does NOT touch Vercel or DNS — run it only AFTER the domain cutover verified + renders. Idempotent: partners already on the shared project are skipped. Pass shared_project_id (required) + shared_project_name (default "storefront-shared"). Scope with partner_id, or migrate all. Dry-run lists who WOULD be repointed. Up to 'limit' per call (default 1000, max ${MAX_REPOINT_SCAN}).`,
  params: [
    {
      name: "shared_project_id",
      type: "string",
      required: true,
      description: "The shared Vercel project id (VERCEL_SHARED_PROJECT_ID)",
    },
    {
      name: "shared_project_name",
      type: "string",
      required: false,
      description: 'The shared project name (default "storefront-shared")',
    },
    {
      name: "partner_id",
      type: "string",
      required: false,
      description: "Restrict to a single partner (default: all Vercel partners)",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: `Max partners per call (default 1000, max ${MAX_REPOINT_SCAN})`,
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const parsed = paramsSchema.safeParse(params)
    if (!parsed.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        parsed.error.issues.map((i) => i.message).join("; ")
      )
    }
    const { shared_project_id, shared_project_name, partner_id, limit } = parsed.data

    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const partnerService: any = container.resolve(PARTNER_MODULE)

    const filters: Record<string, any> = {}
    if (partner_id) filters.id = partner_id

    const { data: partners } = await query.graph({
      entity: "partners",
      fields: [
        "id",
        "name",
        "hosting_provider",
        "deployment_project_id",
        "deployment_project_name",
        "vercel_project_id",
        "vercel_project_name",
      ],
      filters,
    })

    const candidates = (partners || []).filter(
      (p: any) => decideRepointAction(p, shared_project_id) === "repoint"
    )
    const total = candidates.length
    const batch = candidates.slice(0, limit)

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []
    let repointed = 0

    for (const p of batch) {
      changes.push({
        entity: "partner",
        id: p.id,
        field: "deployment_project_id",
        before: p.deployment_project_id ?? p.vercel_project_id ?? "(null)",
        after: shared_project_id,
      })

      if (dry_run) {
        repointed++
        continue
      }

      try {
        await partnerService.updatePartners({
          id: p.id,
          hosting_provider: "vercel",
          deployment_project_id: shared_project_id,
          deployment_project_name: shared_project_name,
          vercel_project_id: shared_project_id,
          vercel_project_name: shared_project_name,
        })
        repointed++
      } catch (e: any) {
        errors.push({ id: p.id, message: e?.message ?? String(e) })
      }
    }

    const verb = dry_run ? "Would repoint" : "Repointed"
    const capped =
      total > batch.length ? ` (capped at ${limit} of ${total} — re-run to continue)` : ""
    const summary = `${verb} ${repointed} partner(s) → ${shared_project_name} (${shared_project_id})${
      errors.length ? `, ${errors.length} error(s)` : ""
    }${capped}.`

    return {
      job_id: repointPartnerStorefrontSharedJob.id,
      dry_run,
      applied: !dry_run && repointed > 0,
      summary,
      changes,
      errors,
    }
  },
}

export default repointPartnerStorefrontSharedJob
