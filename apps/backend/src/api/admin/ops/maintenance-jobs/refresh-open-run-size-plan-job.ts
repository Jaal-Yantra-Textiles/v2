import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { z } from "zod"

import { PRODUCTION_RUNS_MODULE } from "../../../../modules/production_runs"
import { planDesignSizeSplit, formatSizeSplit } from "../../../../workflows/designs/lib/bundle-size-split"
import type { OutputLine } from "../../../../workflows/production-runs/lib/run-output"
import type {
  MaintenanceChange,
  MaintenanceJob,
  MaintenanceJobResult,
} from "./registry"

/**
 * #2500 — bring OPEN runs made before the bundle size work up to it.
 *
 * Runs dispatched before #2505 have no planned size split, so the partner sees
 * "2 pcs" and never "38×1, 40×1". Runs snapshotted before #2509 carry no
 * `color_mode`, so a design later marked "colours are parts of one piece" still
 * makes their completion ask size × colour. Shramdaan's bundle #152
 * (2026-11-02) is both.
 *
 * Per named run, the job:
 *  - copies the design's CURRENT `color_mode` into the run snapshot when they
 *    differ — the snapshot is otherwise left as captured;
 *  - fills a MISSING `planned_output` with the same split new bundles get
 *    (`planDesignSizeSplit`), from the sizes the run SNAPSHOTTED (what its
 *    completion is checked against), never overwriting a plan that exists.
 *
 * Refuses: runs completed or cancelled, runs with `produced_output`, and a
 * split the bundle rule refuses (a garment run that snapshotted no sizes —
 * add sizes to the design and send it again, or plan it by hand).
 */

export const MAX_REFRESH_RUNS = 50

const CLOSED = new Set(["completed", "cancelled"])

const idList = z
  .string()
  .optional()
  .transform((v) =>
    Array.from(
      new Set(
        (v ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      )
    )
  )

const paramsSchema = z.object({
  run_ids: idList.refine(
    (ids) => ids.length > 0 && ids.length <= MAX_REFRESH_RUNS,
    `run_ids must name 1–${MAX_REFRESH_RUNS} production runs`
  ),
})

export type RunSizeRefreshInput = {
  run: {
    id: string
    status?: string | null
    quantity?: number | null
    planned_output?: OutputLine[] | null
    produced_output?: OutputLine[] | null
    snapshot?: Record<string, any> | null
  }
  design: { color_mode?: string | null; product_type?: string | null } | null
}

export type RunSizeRefreshPlan =
  | {
      ok: true
      /** The new snapshot, or null when it does not change. */
      snapshot: Record<string, any> | null
      color_mode: { before: string | null; after: string } | null
      /** The new plan, or null when it does not change. */
      planned_output: OutputLine[] | null
      size_note: string | null
    }
  | { ok: false; reason: string }

/** PURE — what refreshing one run would change. Exported for unit tests. */
export function planRunSizeRefresh(input: RunSizeRefreshInput): RunSizeRefreshPlan {
  const { run, design } = input
  if (CLOSED.has(String(run.status))) {
    return { ok: false, reason: `run is ${run.status}` }
  }
  if (Array.isArray(run.produced_output) && run.produced_output.length) {
    return { ok: false, reason: "run already has produced_output" }
  }
  if (!design) {
    return { ok: false, reason: "design not found" }
  }

  const snap = (run.snapshot ?? {}) as Record<string, any>
  const before = (snap.color_mode as string | undefined) ?? null
  const after = design.color_mode === "parts" ? "parts" : "variants"
  // A snapshot with no colour_mode reads as "variants" (runOutputAxes), so
  // writing "variants" onto it would change nothing but the record.
  const colorChanges = (before ?? "variants") !== after
  const nextSnapshot: Record<string, any> | null = colorChanges ? { ...snap, color_mode: after } : null
  const effective: Record<string, any> = nextSnapshot ?? snap

  let planned: OutputLine[] | null = null
  let sizeNote: string | null = null
  if (!Array.isArray(run.planned_output) || !run.planned_output.length) {
    const sizeLabels = ((effective.size_sets ?? []) as any[])
      .map((s) => String(s?.size_label ?? "").trim())
      .filter(Boolean)
    const colors =
      effective.color_mode === "parts"
        ? []
        : ((effective.colors ?? []) as any[]).map((c) => String(c?.name ?? "").trim()).filter(Boolean)
    const split = planDesignSizeSplit(
      { size_labels: sizeLabels, colors, product_type: design.product_type ?? null },
      { quantity: Number(run.quantity) || 1 }
    )
    if (!split.ok) {
      if (!colorChanges) {
        return { ok: false, reason: split.reason }
      }
      sizeNote = `no size plan: ${split.reason}`
    } else {
      planned = split.planned_output
      sizeNote = formatSizeSplit(split.size_split)
    }
  }

  if (!nextSnapshot && !planned) {
    return { ok: false, reason: sizeNote ?? "nothing to change (plan already set, colour mode already current)" }
  }
  return {
    ok: true,
    snapshot: nextSnapshot,
    color_mode: colorChanges ? { before, after } : null,
    planned_output: planned,
    size_note: sizeNote,
  }
}

export const refreshOpenRunSizePlanJob: MaintenanceJob = {
  id: "refresh-open-run-size-plan",
  label: "Refresh open runs' size plan and colour mode (#2500)",
  description:
    "For named OPEN production runs made before the bundle size work: copy the design's current color_mode ('colours are parts of one piece') into the run snapshot, and fill a MISSING planned_output with the same size split new bundles get, from the sizes the run snapshotted. Never overwrites an existing plan; refuses completed/cancelled runs and runs with produced_output. Sends nothing to the partner. Dry-run shows each run's change.",
  params: [
    {
      name: "run_ids",
      type: "string",
      required: true,
      description: `Comma-separated production run ids (1–${MAX_REFRESH_RUNS})`,
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
    const { run_ids } = parsed.data
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const runService: any = container.resolve(PRODUCTION_RUNS_MODULE)

    const runs: any[] = await runService.listProductionRuns(
      { id: run_ids },
      { select: ["id", "status", "quantity", "design_id", "planned_output", "produced_output", "snapshot"] }
    )
    const designIds = [...new Set(runs.map((r) => r.design_id).filter(Boolean))]
    const { data: designs } = designIds.length
      ? await query.graph({
          entity: "design",
          fields: ["id", "name", "color_mode", "product_type"],
          filters: { id: designIds },
        })
      : { data: [] }
    const designById = new Map<string, any>((designs ?? []).map((d: any) => [d.id, d]))

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []
    let updated = 0

    for (const id of run_ids) {
      const run = runs.find((r) => r.id === id)
      if (!run) {
        errors.push({ id, message: "run not found" })
        continue
      }
      const design = designById.get(run.design_id) ?? null
      const plan = planRunSizeRefresh({ run, design })
      if (!plan.ok) {
        errors.push({ id, message: plan.reason })
        continue
      }

      const name = design?.name ?? run.design_id
      if (plan.color_mode) {
        changes.push({
          entity: "production_run",
          id,
          field: "snapshot.color_mode",
          before: plan.color_mode.before,
          after: plan.color_mode.after,
          note: `${name}: design says colours are ${plan.color_mode.after === "parts" ? "parts of one piece — completion will ask by size only" : "separate colour versions"}`,
        })
      }
      if (plan.planned_output) {
        changes.push({
          entity: "production_run",
          id,
          field: "planned_output",
          before: run.planned_output ?? null,
          after: plan.planned_output,
          note: `${name}: ${run.quantity} pcs → ${plan.size_note ?? "one quantity"}`,
        })
      } else if (plan.size_note) {
        changes.push({ entity: "production_run", id, field: "planned_output", note: `${name}: ${plan.size_note}` })
      }

      if (!dry_run) {
        await runService.updateProductionRuns({
          id,
          ...(plan.snapshot ? { snapshot: plan.snapshot } : {}),
          ...(plan.planned_output ? { planned_output: plan.planned_output } : {}),
        })
        updated++
      }
    }

    const touched = new Set(changes.map((c) => c.id)).size
    const verb = dry_run ? "Would refresh" : "Refreshed"
    return {
      job_id: "refresh-open-run-size-plan",
      dry_run,
      applied: !dry_run && updated > 0,
      summary: `${verb} ${dry_run ? touched : updated} of ${run_ids.length} run(s); ${errors.length} left as they are. Nothing is sent to the partner.`,
      changes,
      errors,
    }
  },
}
