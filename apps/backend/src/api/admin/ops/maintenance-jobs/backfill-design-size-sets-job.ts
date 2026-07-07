import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import type {
  MaintenanceChange,
  MaintenanceJob,
  MaintenanceJobResult,
} from "./registry"
import { DESIGN_MODULE } from "../../../../modules/designs"
import {
  convertCustomSizesToSizeSets,
  type NormalizedSizeSet,
} from "../../../../workflows/designs/helpers/size-set-utils"

/**
 * Backfill design `size_sets` from the legacy `custom_sizes` map.
 *
 * Sizes reach a design in two shapes: the normalized `size_sets` relation
 * (`[{ size_label, measurements }]`) and the legacy `custom_sizes` JSON map
 * (`{ "S": { chest, length }, ... }`). The manual create/update workflows
 * convert one to the other, but the **AI/LLM creation path**
 * (`create-design-from-llm`) historically stored `custom_sizes` directly and
 * never populated `size_sets` — so on prod every design carries its sizes on
 * `custom_sizes` and the design manager's Sizes section (which reads
 * `size_sets`) shows nothing.
 *
 * This ports each such design: convert `custom_sizes` → `size_sets`, create the
 * rows, and null out `custom_sizes` (mirroring the create/update workflows'
 * "size_sets wins" rule). Dry-run (default) previews every design that WOULD be
 * ported without writing; apply persists.
 *
 * Idempotent — a design that already has `size_sets` is skipped, and a
 * `custom_sizes` that yields no convertible set (empty / all-non-numeric) is
 * counted, not treated as an error. A genuine per-design failure is recorded in
 * `errors` instead of aborting the sweep.
 */

/** Hard cap on designs scanned in one call. */
export const MAX_DESIGN_SIZE_SET_SCAN = 5000

const paramsSchema = z.object({
  /** Process a single design instead of sweeping all designs. */
  design_id: z.string().min(1).optional(),
  /** Max designs to scan in one call (1..MAX_DESIGN_SIZE_SET_SCAN). */
  limit: z
    .number()
    .int()
    .positive()
    .max(MAX_DESIGN_SIZE_SET_SCAN)
    .optional()
    .default(1000),
})

export type DesignSizeSetDecision =
  | { action: "skip_has_size_sets" }
  | { action: "skip_no_convertible" }
  | { action: "port"; sizeSets: NormalizedSizeSet[] }

/**
 * PURE: decide what to do for one design given whether it already has size_sets
 * and its legacy custom_sizes. Exported for unit testing.
 *   - already has size_sets            → skip (idempotent)
 *   - custom_sizes yields size sets    → port them
 *   - otherwise (empty/unconvertible)  → skip
 */
export function decideDesignSizeSetBackfill(
  hasSizeSets: boolean,
  customSizes: Record<string, any> | null | undefined
): DesignSizeSetDecision {
  if (hasSizeSets) return { action: "skip_has_size_sets" }
  const sizeSets = convertCustomSizesToSizeSets(customSizes)
  if (!sizeSets?.length) return { action: "skip_no_convertible" }
  return { action: "port", sizeSets }
}

/** Pure summary builder — verifiable without booting the DB. */
export function summarizeSizeSetBackfill(
  dryRun: boolean,
  scanned: number,
  portedCount: number,
  alreadyHadCount: number,
  noConvertibleCount: number,
  errorCount: number
): string {
  const verb = dryRun ? "Would port" : "Ported"
  const head =
    portedCount === 0
      ? `No changes — scanned ${scanned} design(s), none needed a size_sets backfill`
      : `${verb} custom_sizes → size_sets on ${portedCount} design(s) (scanned ${scanned})`
  const skips: string[] = []
  if (alreadyHadCount > 0) skips.push(`${alreadyHadCount} already had size_sets`)
  if (noConvertibleCount > 0)
    skips.push(`${noConvertibleCount} no convertible custom_sizes`)
  const tail = skips.length ? `; ${skips.join(", ")}` : ""
  return errorCount > 0 ? `${head}${tail}; ${errorCount} error(s)` : `${head}${tail}`
}

export const backfillDesignSizeSetsJob: MaintenanceJob = {
  id: "backfill-design-size-sets",
  label: "Backfill design size sets from custom_sizes",
  description:
    `Port each design's legacy custom_sizes map into the normalized size_sets relation so the design manager's Sizes section renders. AI-generated designs stored custom_sizes but never populated size_sets. Dry-run previews every design that WOULD be ported without persisting; apply creates the size_sets rows and nulls custom_sizes (size_sets wins). Idempotent — designs that already have size_sets are skipped. Pass design_id to target one design, or sweep up to 'limit' designs (default 1000, max ${MAX_DESIGN_SIZE_SET_SCAN}).`,
  params: [
    {
      name: "design_id",
      type: "string",
      required: false,
      description: "Process a single design instead of sweeping all designs",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: `Max designs to scan in one call (default 1000, max ${MAX_DESIGN_SIZE_SET_SCAN})`,
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
    const { design_id, limit } = parsed.data

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const designService: any = container.resolve(DESIGN_MODULE)

    const { data: designs } = await query.graph({
      entity: "design",
      filters: design_id ? { id: design_id } : {},
      fields: ["id", "name", "custom_sizes", "size_sets.id"],
      pagination: { skip: 0, take: limit },
    })

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []
    let ported = 0
    let alreadyHad = 0
    let noConvertible = 0

    for (const design of (designs || []) as any[]) {
      try {
        const hasSizeSets =
          Array.isArray(design.size_sets) && design.size_sets.length > 0
        const decision = decideDesignSizeSetBackfill(
          hasSizeSets,
          design.custom_sizes
        )

        if (decision.action === "skip_has_size_sets") {
          alreadyHad++
          continue
        }
        if (decision.action === "skip_no_convertible") {
          noConvertible++
          continue
        }

        changes.push({
          entity: "design",
          id: design.id,
          field: "size_sets",
          before: `custom_sizes (${Object.keys(design.custom_sizes || {}).length} label(s))`,
          after: decision.sizeSets.map((s) => s.size_label).join(", "),
        })
        ported++

        if (!dry_run) {
          await designService.createDesignSizeSets(
            decision.sizeSets.map((s) => ({ design_id: design.id, ...s }))
          )
          await designService.updateDesigns({
            id: design.id,
            custom_sizes: null,
          })
        }
      } catch (e: any) {
        errors.push({ id: design.id, message: e?.message ?? String(e) })
      }
    }

    return {
      job_id: backfillDesignSizeSetsJob.id,
      dry_run,
      applied: !dry_run && ported > 0,
      summary: summarizeSizeSetBackfill(
        dry_run,
        (designs || []).length,
        ported,
        alreadyHad,
        noConvertible,
        errors.length
      ),
      changes,
      errors,
    }
  },
}

export default backfillDesignSizeSetsJob
