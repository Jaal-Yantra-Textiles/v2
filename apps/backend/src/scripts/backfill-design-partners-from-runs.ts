import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import designPartnersLink from "../links/design-partners-link"
import { DESIGN_MODULE } from "../modules/designs"
import { PARTNER_MODULE } from "../modules/partner"

/**
 * Backfill `design_partners_link` rows from existing partner-assigned
 * production runs.
 *
 * Why: roadmap item 27. Before
 * `apps/backend/src/workflows/production-runs/approve-production-run.ts`
 * was extended to mirror (design, partner) edges into
 * `design_partners_link`, assignments only set `run.partner_id` and
 * created partner-task links. The partner-side `/partners/designs`
 * surface queries `design_partners_link`, so designs assigned via
 * production runs never appeared on the partner's design list — they
 * could see the run but not the design (e.g. design
 * `01KPET5HBGNH9QXGC0MC8RHR39` was re-assigned to Sharlho via a
 * production run but the design_partners_link still pointed at the
 * earlier assignee).
 *
 * This script walks every non-cancelled production_run with a
 * `partner_id` + `design_id` and creates the missing
 * `design_partners_link` row. Additive — never removes any existing
 * link, never replaces. Multiple partners stay linked to the same
 * design.
 *
 * Idempotent: skips (design_id, partner_id) pairs that already have a
 * link row. Safe to re-run.
 *
 * Run:
 *   npx medusa exec ./src/scripts/backfill-design-partners-from-runs.ts
 *
 * Dry run — logs what would happen, creates nothing:
 *   - Args:    npx medusa exec ./src/scripts/backfill-design-partners-from-runs.ts -- --dry-run
 *   - Env var: DRY_RUN=1 npx medusa exec ./src/scripts/backfill-design-partners-from-runs.ts
 *
 * Scope:
 *   --partner-ids=par_a,par_b   (or PARTNER_IDS=…)  — limit to a subset of partners
 *   --design-ids=des_a,des_b    (or DESIGN_IDS=…)   — limit to a subset of designs
 */
export default async function backfillDesignPartnersFromRuns({
  container,
  args,
}: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const remoteLink = container.resolve(
    ContainerRegistrationKeys.LINK
  ) as any

  const argList = args ?? []
  const dryRun = argList.includes("--dry-run") || process.env.DRY_RUN === "1"

  const parseListArg = (flag: string, envVar: string): string[] | null => {
    const fromArg = argList
      .map((a) => (a.startsWith(`${flag}=`) ? a.slice(flag.length + 1) : null))
      .find((v): v is string => v !== null)
    const raw = fromArg ?? process.env[envVar] ?? ""
    if (!raw.trim()) return null
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  }

  const partnerIdFilter = parseListArg("--partner-ids", "PARTNER_IDS")
  const designIdFilter = parseListArg("--design-ids", "DESIGN_IDS")

  if (dryRun) logger.info("DRY RUN — no links will be created.")
  if (partnerIdFilter?.length) {
    logger.info(`Partner scope: ${partnerIdFilter.join(", ")}`)
  }
  if (designIdFilter?.length) {
    logger.info(`Design scope: ${designIdFilter.join(", ")}`)
  }

  // 1. Every non-cancelled run with both a partner and a design.
  const { data: runs } = await query.graph({
    entity: "production_runs",
    filters: { status: { $nin: ["cancelled"] } } as any,
    fields: ["id", "design_id", "partner_id", "status"],
    pagination: { skip: 0, take: 5000 },
  })

  // 2. Distinct (design_id, partner_id) pairs from those runs, with
  //    the scoping filters applied.
  const pairKey = (designId: string, partnerId: string) =>
    `${designId}::${partnerId}`
  const wantedPairs = new Map<string, { design_id: string; partner_id: string }>()
  for (const r of (runs ?? []) as any[]) {
    const designId = r?.design_id
    const partnerId = r?.partner_id
    if (!designId || !partnerId) continue
    if (partnerIdFilter && !partnerIdFilter.includes(partnerId)) continue
    if (designIdFilter && !designIdFilter.includes(designId)) continue
    wantedPairs.set(pairKey(designId, partnerId), {
      design_id: designId,
      partner_id: partnerId,
    })
  }

  if (!wantedPairs.size) {
    logger.info(
      `No partner-assigned production runs found${
        partnerIdFilter || designIdFilter ? " within the given scope" : ""
      }. Nothing to backfill.`
    )
    return
  }

  // 3. Existing design_partners_link rows for the wanted designs only.
  //    Filtering server-side keeps the query fast on a busy DB.
  const designIds = Array.from(
    new Set(Array.from(wantedPairs.values()).map((p) => p.design_id))
  )
  const { data: existingLinks } = await query.graph({
    entity: designPartnersLink.entryPoint,
    filters: { design_id: designIds },
    fields: ["design_id", "partner_id"],
  })
  const linkedPairs = new Set<string>(
    (existingLinks ?? []).map((l: any) => pairKey(l.design_id, l.partner_id))
  )

  let created = 0
  let alreadyLinked = 0
  const errors: Array<{ design_id: string; partner_id: string; error: string }> = []

  for (const { design_id, partner_id } of wantedPairs.values()) {
    const tag = `design ${design_id} ↔ partner ${partner_id}`
    if (linkedPairs.has(pairKey(design_id, partner_id))) {
      alreadyLinked++
      continue
    }

    if (dryRun) {
      logger.info(`${tag}: WOULD create link`)
      created++
      continue
    }

    try {
      await remoteLink.create({
        [DESIGN_MODULE]: { design_id },
        [PARTNER_MODULE]: { partner_id },
      })
      linkedPairs.add(pairKey(design_id, partner_id))
      logger.info(`${tag}: created link`)
      created++
    } catch (err) {
      const message = err instanceof Error ? err.message : JSON.stringify(err)
      logger.error(`${tag}: failed — ${message}`)
      errors.push({ design_id, partner_id, error: message })
    }
  }

  logger.info(
    `Backfill complete. created=${created}, already_linked=${alreadyLinked}, pairs=${wantedPairs.size}, errors=${errors.length}${
      dryRun ? " (DRY RUN)" : ""
    }`
  )

  if (errors.length) {
    logger.error("Errors during backfill — review the log above:")
    for (const e of errors) {
      logger.error(`  design=${e.design_id} partner=${e.partner_id}: ${e.error}`)
    }
    process.exitCode = 1
  }
}
