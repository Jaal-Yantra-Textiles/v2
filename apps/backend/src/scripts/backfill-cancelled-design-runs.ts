import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { ExecArgs } from "@medusajs/framework/types"
import { PRODUCTION_RUNS_MODULE } from "../modules/production_runs"
import { DESIGN_MODULE } from "../modules/designs"

/**
 * Backfill: migrate legacy "cancelled partner assignment" designs onto the
 * single-source-of-truth model (production runs).
 *
 * Background: partner_status used to read a metadata marker
 * (`design.metadata.partner_assignment_cancelled_at`). After the
 * single-source refactor, run-backed designs derive status purely from
 * production_runs, but a handful of legacy designs still carry only the
 * marker. This script makes runs authoritative for ALL marked designs so
 * the marker + v1-task fallback can be removed later (see
 * V1_PARTNER_DESIGN_REMOVAL_PLAN.md).
 *
 * Per marked design (metadata.partner_assignment_cancelled_at set):
 *   - If the (design, cancelled-partner) pair has NO production run, create
 *     a terminal `cancelled` run so the derivation returns "cancelled" from
 *     the run instead of the marker.
 *   - Clear the marker (partner_assignment_cancelled_at +
 *     partner_assignment_cancelled_partner_id → null).
 *
 * Idempotent: skips run creation when a cancelled run already exists for
 * the pair, and skips designs whose marker is already cleared.
 *
 * Usage:
 *   DRY_RUN=1 npx medusa exec ./src/scripts/backfill-cancelled-design-runs.ts
 *   npx medusa exec ./src/scripts/backfill-cancelled-design-runs.ts
 *   (scope) --design-ids=des_a,des_b   or DESIGN_IDS=…
 */
export default async function backfillCancelledDesignRuns({
  container,
  args,
}: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const runService: any = container.resolve(PRODUCTION_RUNS_MODULE)
  const designService: any = container.resolve(DESIGN_MODULE)

  const argList = args ?? []
  const dryRun = argList.includes("--dry-run") || process.env.DRY_RUN === "1"
  const designFromArg = argList
    .map((a) => (a.startsWith("--design-ids=") ? a.slice("--design-ids=".length) : null))
    .find((v): v is string => v !== null)
  const designIdFilter = (designFromArg ?? process.env.DESIGN_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)

  if (dryRun) logger.info("DRY RUN — no runs created, no markers cleared.")
  if (designIdFilter.length) logger.info(`Design scope: ${designIdFilter.join(", ")}`)

  // Find marked designs (metadata filtering is done in-memory — the design
  // table is small and metadata isn't a server-side filterable column).
  const { data: designs } = await query.graph({
    entity: "design",
    fields: ["id", "name", "metadata", "partners.id"],
    pagination: { skip: 0, take: 5000 },
  })

  const marked = (designs ?? []).filter((d: any) => {
    if (designIdFilter.length && !designIdFilter.includes(d.id)) return false
    return !!d?.metadata?.partner_assignment_cancelled_at
  })

  if (!marked.length) {
    logger.info("No designs with a cancellation marker. Nothing to migrate.")
    return
  }
  logger.info(`Found ${marked.length} marked design(s).`)

  let runsCreated = 0
  let markersCleared = 0
  let skipped = 0
  const errors: string[] = []

  for (const design of marked as any[]) {
    const partnerId =
      design.metadata?.partner_assignment_cancelled_partner_id ||
      (design.partners || [])[0]?.id ||
      null

    try {
      if (!partnerId) {
        logger.warn(`[${design.id}] no cancelled-partner id and no linked partner — clearing marker only`)
      } else {
        // Does the (design, partner) pair already have any run?
        const { data: runs } = await query.graph({
          entity: "production_runs",
          filters: { design_id: design.id, partner_id: partnerId },
          fields: ["id", "status"],
        })
        const hasAnyRun = (runs ?? []).length > 0
        if (!hasAnyRun) {
          logger.info(
            `[${design.id}] "${(design.name || "").slice(0, 30)}" → create cancelled run for partner ${partnerId}`
          )
          if (!dryRun) {
            await runService.createProductionRuns({
              design_id: design.id,
              partner_id: partnerId,
              status: "cancelled",
              run_type: "production",
              quantity: 1,
              snapshot: { backfill: true, reason: "legacy_partner_assignment_cancelled" },
              captured_at: new Date(),
              cancelled_at: new Date(),
              cancelled_reason: "partner_assignment_cancelled (backfill)",
            })
          }
          runsCreated++
        } else {
          logger.info(`[${design.id}] already has run(s) — marker is vestigial, clearing only`)
        }
      }

      // Clear the (now-vestigial) marker.
      if (!dryRun) {
        await designService.updateDesigns({
          id: design.id,
          metadata: {
            partner_assignment_cancelled_at: null,
            partner_assignment_cancelled_partner_id: null,
          },
        })
      }
      markersCleared++
    } catch (e: any) {
      const msg = `[${design.id}] ${e?.message || e}`
      errors.push(msg)
      logger.error(msg)
    }
  }

  logger.info(
    `${dryRun ? "[DRY RUN] " : ""}Done. cancelled runs created: ${runsCreated}, markers cleared: ${markersCleared}, skipped: ${skipped}, errors: ${errors.length}`
  )
  if (errors.length) {
    logger.error(`Failures:\n${errors.join("\n")}`)
    process.exitCode = 1
  }
}
