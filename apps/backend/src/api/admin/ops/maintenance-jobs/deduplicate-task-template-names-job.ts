import { MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { PRODUCTION_RUNS_MODULE } from "../../../../modules/production_runs"
import { TASKS_MODULE } from "../../../../modules/tasks"
import type TaskService from "../../../../modules/tasks/service"
import {
  findDuplicateTemplateNames,
  resolveUniqueTemplateName,
} from "../../../../workflows/task-templates/unique-name"
import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

/**
 * Data Plumbing — make every task-template name identify ONE template.
 *
 * The live case (#1261): prod carries two templates called "Stitching" that
 * differ ONLY by category — `01JW0Y60…` in Pre Production and `01K5S31S…` in
 * Production. They are different stages of the process wearing one label.
 * Dispatch resolved templates by NAME and took the first match, so a run could
 * be sent the wrong process, and nothing said so afterwards: the task is titled
 * `Stitching` either way, and only `metadata.template_id` records which ran.
 *
 * Dispatch now refuses an ambiguous name rather than guessing, and creates are
 * qualified with their category. Both leave the EXISTING pair in place — this
 * job is what clears it, renaming the later duplicates to
 * `Stitching (Pre Production)` so the name is usable again.
 *
 * ⚠️ A rename changes what a stored NAME resolves to. Runs approved with
 * `dispatch_template_names` recorded the name, not the id, so this job counts
 * and lists the runs whose recorded intent mentions each name it is about to
 * change — a rename that silently re-points someone's pending dispatch is
 * exactly the class of bug this whole thread is about. Read the dry-run.
 *
 * The KEPT row is the oldest — the one the catalogue has answered to longest,
 * so the fewest existing references change meaning. Everything after it is
 * qualified.
 */

const paramsSchema = z.object({
  /** Only this name, e.g. just "Stitching". Omit to sweep every duplicate. */
  name: z.string().min(1).optional(),
  /**
   * Rename the row in THIS category instead of keeping the oldest. Use when
   * the older row is the one that should carry the qualifier.
   */
  rename_category: z.string().min(1).optional(),
})

type TemplateRow = {
  id: string
  name: string
  category_name: string | null
  created_at?: string | Date | null
}

/**
 * PURE: which rows to rename, and to what. Exported for unit tests.
 *
 * Keeps one row per colliding name and qualifies the rest. Order of the keep
 * decision is oldest-first, so the name keeps pointing where it has always
 * pointed unless `renameCategory` says otherwise.
 */
export function planTemplateNameDeduplication(
  templates: TemplateRow[],
  options: { name?: string; renameCategory?: string } = {}
): Array<{
  id: string
  category_name: string | null
  before: string
  after: string
  kept_id: string
}> {
  const groups = findDuplicateTemplateNames(templates as any).filter((g) =>
    options.name
      ? g.name.trim().toLowerCase() === options.name.trim().toLowerCase()
      : true
  )

  const out: Array<{
    id: string
    category_name: string | null
    before: string
    after: string
    kept_id: string
  }> = []

  // Names claimed as we go, so two renames in one run cannot collide with each
  // other — a batch that produced its own duplicate would be absurd.
  const claimed: TemplateRow[] = [...templates]

  for (const group of groups) {
    const rows = (group.templates as unknown as TemplateRow[]).slice()

    const byCategory = options.renameCategory
      ? rows.filter(
          (r) =>
            (r.category_name ?? "").trim().toLowerCase() ===
            options.renameCategory!.trim().toLowerCase()
        )
      : []

    let keep: TemplateRow
    if (byCategory.length && byCategory.length < rows.length) {
      // Rename the named category — so keep everything else's claim on the
      // name, which only makes sense when exactly one other row remains.
      keep = rows.find((r) => !byCategory.includes(r))!
    } else {
      keep = rows
        .slice()
        .sort((a, b) => {
          const at = a.created_at ? new Date(a.created_at).getTime() : 0
          const bt = b.created_at ? new Date(b.created_at).getTime() : 0
          return at - bt || String(a.id).localeCompare(String(b.id))
        })[0]
    }

    for (const row of rows) {
      if (row.id === keep.id) {
        continue
      }
      const unique = resolveUniqueTemplateName(
        row.name,
        row.category_name,
        claimed as any,
        row.id
      )
      if (!unique.qualified || unique.name === row.name) {
        continue
      }
      out.push({
        id: row.id,
        category_name: row.category_name,
        before: row.name,
        after: unique.name,
        kept_id: keep.id,
      })
      // Claim the new name for the rest of this pass.
      claimed.push({ ...row, name: unique.name })
    }
  }

  return out
}

export const deduplicateTaskTemplateNamesJob: MaintenanceJob = {
  id: "deduplicate-task-template-names",
  label: "Make every task-template name identify one template",
  description:
    "Find task templates that SHARE a name and qualify the duplicates with their category — prod's two 'Stitching' rows (Pre Production and Production) become 'Stitching' and 'Stitching (Pre Production)'. A shared name is why dispatch could instantiate the wrong process invisibly (#1261): the task is titled the same either way. The oldest row keeps the bare name so existing references change meaning as little as possible. ⚠️ Runs approved with dispatch_template_names recorded a NAME, so the dry-run lists the runs whose recorded intent mentions each name being changed — read it before applying. Safe to re-run: it is a no-op once every name is unique.",
  params: [
    {
      name: "name",
      type: "string",
      required: false,
      description: "Only this template name, e.g. 'Stitching'.",
    },
    {
      name: "rename_category",
      type: "string",
      required: false,
      description:
        "Rename the row in this category instead of keeping the oldest, e.g. 'Pre Production'.",
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

    const taskService: TaskService = container.resolve(TASKS_MODULE)

    const templates = await (taskService as any).listTaskTemplates(
      {},
      { take: null, relations: ["category"] }
    )

    const rows: TemplateRow[] = (templates || [])
      .filter((t: any) => typeof t?.name === "string" && t.name.length)
      .map((t: any) => ({
        id: t.id,
        name: t.name,
        category_name: t.category?.name ?? null,
        created_at: t.created_at ?? null,
      }))

    const renames = planTemplateNameDeduplication(rows, {
      name: parsed.data.name,
      renameCategory: parsed.data.rename_category,
    })

    /**
     * Who is still holding one of these names as a stored INTENT.
     *
     * `dispatch_template_names` is a name list recorded at approval, so a
     * rename re-points it. Reported rather than rewritten: the run recorded
     * what someone chose, and deciding it meant the kept row or the renamed one
     * is a judgement about which process the partner should follow.
     */
    const affectedRuns: Array<{
      production_run_id: string
      name: string
      dispatch_template_names: string[]
    }> = []
    if (renames.length) {
      try {
        const runService: any = container.resolve(PRODUCTION_RUNS_MODULE)
        const [runs] = await runService.listAndCountProductionRuns(
          {},
          { take: null }
        )
        const changedNames = new Set(renames.map((r) => r.before))
        for (const run of runs || []) {
          const intent = (run?.dispatch_template_names ?? []) as string[]
          const hit = (intent || []).find((n) => changedNames.has(n))
          if (hit) {
            affectedRuns.push({
              production_run_id: run.id,
              name: hit,
              dispatch_template_names: intent,
            })
          }
        }
      } catch {
        // Impact reporting is a courtesy. Losing it must not silently turn
        // into "no runs affected", so the summary says when it is unknown.
      }
    }

    const changes: MaintenanceChange[] = renames.map((r) => ({
      entity: "task_template",
      id: r.id,
      field: "name",
      before: r.before,
      after: r.after,
    }))

    if (!dry_run && renames.length > 0) {
      for (const r of renames) {
        await (taskService as any).updateTaskTemplates({
          selector: { id: r.id },
          data: { name: r.after },
        })
      }
    }

    const summary = [
      renames.length
        ? `${dry_run ? "Would rename" : "Renamed"} ${renames.length} duplicate template name(s): ${renames
            .map(
              (r) =>
                `${r.id} "${r.before}" → "${r.after}" (${
                  r.category_name ?? "uncategorised"
                }); "${r.before}" stays with ${r.kept_id}`
            )
            .join("; ")}`
        : `Every task-template name already identifies one template (${rows.length} template(s) checked)`,
      // Stated whenever a rename is planned, including the zero case — silence
      // here would read as "nothing depends on this name", which is a claim.
      renames.length
        ? affectedRuns.length
          ? `⚠️ ${affectedRuns.length} production run(s) recorded one of these names as their dispatch intent and will resolve to the KEPT template after the rename: ${affectedRuns
              .map((r) => `${r.production_run_id} (${r.name})`)
              .join(", ")}. Check each is the process you mean, or dispatch it with template_ids.`
          : `No production run recorded any of these names as a dispatch intent.`
        : "",
    ]
      .filter(Boolean)
      .join(". ")

    return {
      job_id: deduplicateTaskTemplateNamesJob.id,
      dry_run,
      applied: !dry_run && renames.length > 0,
      summary,
      changes,
    }
  },
}
