/**
 * Read and correct a single `textile_analysis` row.
 *
 *   GET   /admin/textile-analyses/:id   → the row, hydrated with its media file
 *   PATCH /admin/textile-analyses/:id   → edit what the vision model saw
 *
 * The list route (`./route.ts`) exists so the library can be filtered. This
 * route exists so a person can FIX one row — before it, the only writer was
 * the extractor and everything it misread stayed misread. The edit surface is
 * deliberately the same fields the list renders as badges, plus the prose that
 * mirrors onto `MediaFile.title`/`description` (see `lib/persist.ts` for why
 * the mirror matters: the media columns are searchable and sat empty while the
 * blob held the answers).
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import mediaTextileAnalysisLink from "../../../../links/media-textile-analysis-link"
import { MEDIA_MODULE } from "../../../../modules/media"
import { TEXTILE_ANALYSIS_MODULE } from "../../../../modules/textile-analysis"
import { AdminUpdateTextileAnalysisSchema } from "../validators"

/** Filter/decide columns: trim + lowercase, as `normalise.ts` does. */
const norm = (v: unknown): string | undefined => {
  if (typeof v !== "string") return undefined
  const s = v.trim().toLowerCase()
  return s.length ? s : undefined
}

/** Prose: trim only, preserving case. */
const trim = (v: unknown): string | undefined => {
  if (typeof v !== "string") return undefined
  const s = v.trim()
  return s.length ? s : undefined
}

const strArray = (v: unknown): string[] | null => {
  if (!Array.isArray(v)) return null
  const out = v
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean)
  return out.length ? out : null
}

/** Attach the analysis's linked media file, mirroring the list route. */
const hydrateMedia = async (
  req: MedusaRequest,
  analysisId: string
): Promise<Record<string, any> | null> => {
  const mediaService: any = req.scope.resolve(MEDIA_MODULE)
  const query: any = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: links = [] } = await query.graph({
    entity: mediaTextileAnalysisLink.entryPoint,
    fields: ["media_file_id", "textile_analysis_id"],
    filters: { textile_analysis_id: analysisId },
  })

  const mediaId = (links as any[]).find(Boolean)?.media_file_id
  if (!mediaId) return null

  const files: any[] = await mediaService.listMediaFiles(
    { id: mediaId },
    { take: 1 }
  )
  const file = files[0]
  if (!file) return null

  return {
    id: file.id,
    file_name: file.file_name,
    file_path: file.file_path,
    title: file.title,
  }
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(TEXTILE_ANALYSIS_MODULE)
  const { id } = req.params as Record<string, string>

  const rows: any[] = await service.listTextileAnalyses({ id }, { take: 1 })
  const row = rows[0]
  if (!row) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Textile analysis ${id} not found`
    )
  }

  const media = await hydrateMedia(req, id)

  res.json({ textile_analysis: { ...row, media } })
}

export const PATCH = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(TEXTILE_ANALYSIS_MODULE)
  const mediaService: any = req.scope.resolve(MEDIA_MODULE)
  const { id } = req.params as Record<string, string>

  const parsed = AdminUpdateTextileAnalysisSchema.parse(req.validatedBody ?? req.body)

  const updateData: Record<string, any> = {}

  if (parsed.source !== undefined) updateData.source = parsed.source
  if (parsed.confidence !== undefined) updateData.confidence = parsed.confidence

  // Filter columns: normalised the way the extractor normalises them.
  for (const field of [
    "cloth_type",
    "category",
    "pattern",
    "fabric_weight",
    "weave_or_knit",
    "primary_color",
  ] as const) {
    if (parsed[field] !== undefined) updateData[field] = norm(parsed[field]) ?? null
  }

  // Prose.
  if (parsed.title !== undefined) updateData.title = trim(parsed.title) ?? null
  if (parsed.description !== undefined)
    updateData.description = trim(parsed.description) ?? null
  if (parsed.target_audience !== undefined)
    updateData.target_audience = trim(parsed.target_audience) ?? null

  for (const field of [
    "colors",
    "season",
    "occasion",
    "care_instructions",
  ] as const) {
    if (parsed[field] !== undefined) updateData[field] = strArray(parsed[field])
  }

  const updated = await service.updateTextileAnalyses({ id, ...updateData })
  const row = Array.isArray(updated) ? updated[0] : updated

  // Mirror title/description onto the linked media file — the searchable
  // columns that persist.ts keeps in step on the write path. Guarded, since a
  // failed mirror must never cost the correction itself.
  if (row && (updateData.title !== undefined || updateData.description !== undefined)) {
    const media = await hydrateMedia(req, id)
    if (media) {
      const mirror: Record<string, any> = {}
      if (updateData.title !== undefined) mirror.title = updateData.title
      if (updateData.description !== undefined) {
        mirror.description = updateData.description
        mirror.alt_text = updateData.description
      }
      await mediaService.updateMediaFiles({ id: media.id, ...mirror }).catch(() => {})
    }
  }

  const media = await hydrateMedia(req, id)

  res.json({ textile_analysis: { ...row, media } })
}