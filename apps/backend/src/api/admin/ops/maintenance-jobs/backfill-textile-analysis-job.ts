import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { MEDIA_MODULE } from "../../../../modules/media"
import { TEXTILE_ANALYSIS_MODULE } from "../../../../modules/textile-analysis"
import mediaTextileAnalysisLink from "../../../../links/media-textile-analysis-link"
import { normaliseTextileAnalysis } from "../../../../modules/textile-analysis/lib/normalise"
import type {
  MaintenanceChange,
  MaintenanceJob,
  MaintenanceJobResult,
} from "./registry"

/**
 * Move the existing `metadata.textile_extraction` blobs into typed
 * `textile_analysis` rows.
 *
 * ## Why these 37 rows are worth moving
 *
 * Measured on production: of the media files carrying the blob, **every one had
 * a `title` and a `description` inside it and NONE had the typed
 * `MediaFile.title` / `description` / `alt_text` columns set** — columns that
 * already existed, with `title` one of the two `.searchable()` fields. A good
 * title was computed for each and the media library, SEO and screen-reader alt
 * text all read the empty column instead.
 *
 * They were also unfilterable. `query.graph` cannot reach into JSON subkeys, so
 * "show me more fabrics like this" — the reason this data is collected — could
 * not be built on them. Until this runs, the new module holds only what has
 * been extracted SINCE it shipped, and every earlier extraction stays invisible
 * to the feature it was gathered for.
 *
 * ## What it does NOT do
 *
 * 🔑 It leaves `metadata.textile_extraction` in place. Deleting it would make
 * this irreversible, and `metadata` is a bag shared with the partner upload,
 * WhatsApp and raw-material-binding writers — a whole-object rewrite to remove
 * one key is exactly the hazard the module was created to escape. The blob
 * becomes vestigial, and retiring it is a separate, later decision.
 *
 * Idempotent: a media file that already has an `internal_extraction` row is
 * skipped, so a re-run cannot double-create.
 */

const paramsSchema = z.object({
  media_id: z.string().min(1).optional(),
  limit: z.number().int().positive().max(1000).optional(),
})

export const backfillTextileAnalysisJob: MaintenanceJob = {
  id: "backfill-textile-analysis",
  label: "Backfill textile analysis rows from media metadata",
  description:
    "Create a typed `textile_analysis` row (and its media link) for every media file carrying `metadata.textile_extraction`, and mirror the extractor's title/description onto the media file's own searchable columns — which every one of those files left empty. Dry-run previews each file, what would be typed from it, and what the mirror would set. Idempotent: a file that already has an internal_extraction row is skipped. Leaves the original metadata blob in place; retiring it is a separate decision.",
  params: [
    {
      name: "media_id",
      type: "string",
      required: false,
      description: "Only this media file (start here — verify one before sweeping)",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: "Cap how many files are considered (default 1000)",
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const parsed = paramsSchema.safeParse(params ?? {})
    if (!parsed.success) {
      throw new Error(parsed.error.issues.map((i) => i.message).join("; "))
    }
    const { media_id, limit } = parsed.data

    const mediaService: any = container.resolve(MEDIA_MODULE)
    const analysisService: any = container.resolve(TEXTILE_ANALYSIS_MODULE)
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const link: any = container.resolve(ContainerRegistrationKeys.LINK)

    const files: any[] = await mediaService.listMediaFiles(
      media_id ? { id: media_id } : {},
      { take: limit ?? 1000 }
    )

    const candidates = files.filter((f) => f?.metadata?.textile_extraction)

    /**
     * Which of them already have an internal-extraction row.
     *
     * ⚠️ Checked in ONE query rather than per file. `filters: { id: [] }` is NO
     * filter, not "no rows" (#1433), so the empty case returns before the graph
     * is ever asked — otherwise an empty candidate list would read every link
     * on the platform and mark everything as already done.
     */
    const alreadyDone = new Set<string>()
    if (candidates.length) {
      const { data: links = [] } = await query.graph({
        entity: mediaTextileAnalysisLink.entryPoint,
        fields: ["media_file_id", "textile_analysis_id"],
        filters: { media_file_id: candidates.map((f) => f.id) },
      })
      for (const l of links as any[]) {
        if (l?.media_file_id) alreadyDone.add(l.media_file_id)
      }
    }

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []
    let created = 0

    for (const file of candidates) {
      if (alreadyDone.has(file.id)) {
        changes.push({
          entity: "media_file",
          id: file.id,
          field: "textile_analysis",
          before: "already migrated",
          after: "skipped",
          note: "a textile_analysis row is already linked to this media file",
        })
        continue
      }

      const payload = file.metadata.textile_extraction as Record<string, any>
      const normalised = normaliseTextileAnalysis(payload, {
        source: "internal_extraction",
        analyzed_at: file.metadata?.extracted_at ?? file.created_at ?? null,
      })

      // What the mirror would set — reported, because these columns being empty
      // is half the reason this backfill exists.
      const mirrorNote = [
        !file.title && normalised.title ? `title←"${normalised.title.slice(0, 40)}"` : null,
        !file.description && normalised.description ? "description←extractor" : null,
        !file.alt_text && normalised.description ? "alt_text←extractor" : null,
      ]
        .filter(Boolean)
        .join(", ")

      changes.push({
        entity: "media_file",
        id: file.id,
        field: "textile_analysis",
        before: null,
        after: `${normalised.cloth_type ?? "?"} / ${normalised.pattern ?? "?"} / ${
          normalised.fabric_weight ?? "?"
        } / ${normalised.primary_color ?? "?"}`,
        note: mirrorNote || "typed row only (media columns already set)",
      })

      if (dry_run) {
        created++
        continue
      }

      try {
        const row = await analysisService.createTextileAnalyses(normalised)
        const analysis = Array.isArray(row) ? row[0] : row
        if (!analysis?.id) throw new Error("no id returned")

        await link.create({
          [MEDIA_MODULE]: { media_file_id: file.id },
          [TEXTILE_ANALYSIS_MODULE]: { textile_analysis_id: analysis.id },
        })

        /**
         * Mirror ONLY into columns that are empty. An operator who has since
         * written their own title should not have it overwritten by a model's
         * — the backfill is filling gaps, not asserting authorship.
         */
        const mirror: Record<string, any> = {}
        if (!file.title && normalised.title) mirror.title = normalised.title
        if (!file.description && normalised.description) {
          mirror.description = normalised.description
        }
        if (!file.alt_text && normalised.description) {
          mirror.alt_text = normalised.description
        }
        if (Object.keys(mirror).length) {
          await mediaService.updateMediaFiles({ id: file.id, ...mirror })
        }

        created++
      } catch (e: any) {
        errors.push({ id: file.id, message: e?.message ?? String(e) })
      }
    }

    const summary = `${dry_run ? "Would create" : "Created"} ${created} textile_analysis row(s) from ${
      candidates.length
    } media file(s) carrying metadata.textile_extraction${
      errors.length ? ` — ${errors.length} failed` : ""
    }`

    return {
      job_id: backfillTextileAnalysisJob.id,
      dry_run,
      applied: !dry_run && created > 0,
      summary,
      changes,
      errors,
    }
  },
}

export default backfillTextileAnalysisJob
