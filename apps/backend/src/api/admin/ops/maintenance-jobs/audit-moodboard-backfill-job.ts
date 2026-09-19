import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import type {
  MaintenanceChange,
  MaintenanceJob,
  MaintenanceJobResult,
} from "./registry"

/**
 * Data Plumbing — did the #2017 moodboard backfill actually land?
 *
 * ## Why this exists
 *
 * `Migration20260919120000` copies every non-empty `design.moodboard` blob
 * into a `core` row of the new `design_moodboard` table. The deploy log proves
 * the migration RAN; it does not say how many rows it inserted, and no read
 * surface could answer that — `get_design` predates the relation, and nothing
 * else reaches the table.
 *
 * "The migration exited 0" and "every board has a row" are different claims.
 * This job measures the second one.
 *
 * ## What it compares
 *
 * Designs whose legacy blob has content, against designs that have a core
 * board row. The interesting number is the GAP: a design carrying a scene in
 * the column with no row to match it. That design still renders — the
 * `resolveBoards` fallback shows the blob when there are no rows — but it
 * renders as SOMEBODY ELSE'S board to a partner, read-only, because the blob
 * is presented as the core one. So a missed backfill is not invisible; it is
 * a partner who cannot edit a board they should own.
 *
 * ## Applying
 *
 * Creates the missing core rows, using the same emptiness rule as the
 * migration. Additive and idempotent — it never touches a design that already
 * has a core row, and never modifies the blob.
 */

export const MAX_MOODBOARD_BACKFILL_SCAN = 5000

const paramsSchema = z.object({
  limit: z
    .number()
    .int()
    .positive()
    .max(MAX_MOODBOARD_BACKFILL_SCAN)
    .optional()
    .default(500),
})

/**
 * Is this blob a board somebody has actually drawn on?
 *
 * 🔑 The SAME rule the migration uses. A board that is `{}` or
 * `{"elements": []}` is one nobody started, and minting a core row for it
 * would turn "never started" into "started and blank" across the table. If
 * this rule and the migration's ever diverge, this job reports a gap that is
 * not real and then "repairs" it into existence.
 */
export const blobHasContent = (blob: unknown): boolean => {
  if (!blob || typeof blob !== "object" || Array.isArray(blob)) {
    return false
  }
  const els = (blob as { elements?: unknown }).elements
  return Array.isArray(els) && els.length > 0
}

/** Operator-facing sentence. Exported so the wording is testable. */
export const summarizeBackfill = (
  dryRun: boolean,
  withBlob: number,
  withCore: number,
  missing: number
): string => {
  const head =
    `${withBlob} design${withBlob === 1 ? "" : "s"} ` +
    `${withBlob === 1 ? "carries" : "carry"} a legacy moodboard; ` +
    `${withCore} ${withCore === 1 ? "has" : "have"} a core board row.`
  if (missing === 0) {
    return `${head} Nothing is missing — the backfill is complete.`
  }
  const verb = dryRun ? "Would create" : "Created"
  return `${head} ${verb} ${missing} missing core board${missing === 1 ? "" : "s"}.`
}

export const auditMoodboardBackfillJob: MaintenanceJob = {
  id: "audit-moodboard-backfill",
  label: "Check every legacy moodboard has a core board row (#2017)",
  description:
    "Compare designs holding a non-empty `design.moodboard` blob against designs that have a `core` row in `design_moodboard`. Migration20260919120000 copies the former into the latter; the deploy log proves it ran but not how many rows it wrote, and no other read surface reaches the table. A design with a blob and no row still renders — the resolveBoards fallback shows it — but it shows as the CORE board, so a partner sees it read-only and cannot edit a board they should own. Preview (default) reports the counts and names the gap; apply creates the missing core rows using the migration's own emptiness rule.",
  params: [
    {
      name: "limit",
      type: "number",
      required: false,
      description: `Max designs to repair in one call (default 500, max ${MAX_MOODBOARD_BACKFILL_SCAN})`,
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
    const { limit } = parsed.data

    const knex: any = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)

    /**
     * Raw SQL, like the dangling-link audit: the question is about the SHAPE of
     * a jsonb column across the whole table, which no ORM read expresses, and
     * counting via the module service would mean loading every design's scene
     * into memory to look at `elements.length`.
     */
    const { rows: counts } = await knex.raw(`
      select
        (select count(*) from "design" d
          where d."deleted_at" is null
            and jsonb_typeof(d."moodboard") = 'object'
            and jsonb_typeof(d."moodboard"->'elements') = 'array'
            and jsonb_array_length(d."moodboard"->'elements') > 0
        ) as with_blob,
        (select count(*) from "design_moodboard" m
          where m."owner_type" = 'core' and m."deleted_at" is null
        ) as with_core,
        (select count(*) from "design_moodboard" m
          where m."owner_type" = 'partner' and m."deleted_at" is null
        ) as partner_boards
    `)
    const withBlob = Number(counts?.[0]?.with_blob ?? 0)
    const withCore = Number(counts?.[0]?.with_core ?? 0)
    const partnerBoards = Number(counts?.[0]?.partner_boards ?? 0)

    // The gap: a blob with content and no core row to match it.
    const { rows: gaps } = await knex.raw(
      `
      select d."id", d."name",
             jsonb_array_length(d."moodboard"->'elements') as element_count
        from "design" d
       where d."deleted_at" is null
         and jsonb_typeof(d."moodboard") = 'object'
         and jsonb_typeof(d."moodboard"->'elements') = 'array'
         and jsonb_array_length(d."moodboard"->'elements') > 0
         and not exists (
           select 1 from "design_moodboard" m
            where m."design_id" = d."id"
              and m."owner_type" = 'core'
              and m."deleted_at" is null
         )
       order by d."updated_at" desc
       limit ?
    `,
      [limit]
    )

    const changes: MaintenanceChange[] = (gaps ?? []).map((g: any) => ({
      entity: "design",
      id: String(g.id),
      field: "design_moodboard.core",
      before: null,
      after: dry_run ? "would create" : "created",
      note: `"${g.name}" holds a ${g.element_count}-element board with no core row — a partner sees it read-only`,
    }))

    if (!dry_run && gaps?.length) {
      await knex.raw(
        `
        insert into "design_moodboard"
          ("id", "owner_type", "partner_id", "scene", "design_id", "created_at", "updated_at")
        select
          'dmb_' || replace(gen_random_uuid()::text, '-', ''),
          'core', null, d."moodboard", d."id", now(), now()
          from "design" d
         where d."id" = any(?)
           and not exists (
             select 1 from "design_moodboard" m
              where m."design_id" = d."id"
                and m."owner_type" = 'core'
                and m."deleted_at" is null
           )
      `,
        [gaps.map((g: any) => String(g.id))]
      )
    }

    return {
      job_id: auditMoodboardBackfillJob.id,
      dry_run,
      applied: !dry_run && (gaps?.length ?? 0) > 0,
      summary:
        summarizeBackfill(dry_run, withBlob, withCore, gaps?.length ?? 0) +
        ` ${partnerBoards} partner board${partnerBoards === 1 ? "" : "s"} exist.`,
      changes,
    }
  },
}
