/**
 * Fabrics and garments, searchable by what a vision model saw in them.
 *
 *   GET /admin/textile-analyses?cloth_type=&pattern=&fabric_weight=
 *                              &primary_color=&source=&q=&limit=&offset=
 *
 * ## Why this exists
 *
 * The analysis used to live in `MediaFile.metadata.textile_extraction`, and
 * `query.graph` cannot filter or sort into JSON subkeys — so "show me more
 * fabrics like this" was not buildable on it, and nothing rendered it either.
 * The data was collected 37 times and read zero times.
 *
 * Typed columns made the question askable; this route is where it gets asked.
 * Every filter here is an indexed column on `textile_analysis`, which is the
 * entire reason those fields are columns rather than keys in a blob.
 *
 * 🔑 Returns the MEDIA alongside each row. An analysis without its picture is
 * unusable for the thing it is for — choosing a fabric — and making the client
 * fetch them separately would be N+1 over a grid.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import mediaTextileAnalysisLink from "../../../links/media-textile-analysis-link"
import { MEDIA_MODULE } from "../../../modules/media"
import { TEXTILE_ANALYSIS_MODULE } from "../../../modules/textile-analysis"

/** Filters are normalised the way the writer normalises them, or they miss. */
const norm = (v: unknown): string | undefined => {
  if (typeof v !== "string") return undefined
  const s = v.trim().toLowerCase()
  return s.length ? s : undefined
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const q = req.query as Record<string, any>
  const service: any = req.scope.resolve(TEXTILE_ANALYSIS_MODULE)
  const mediaService: any = req.scope.resolve(MEDIA_MODULE)
  const query: any = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const limit = Math.min(Number(q.limit) || 50, 200)
  const offset = Number(q.offset) || 0

  /**
   * ⚠️ Only filters the caller actually supplied. A key set to `undefined`
   * would be NO filter, which is right — but a key set to `""` filters FOR the
   * empty string and silently returns nothing, which is how a search box that
   * has been focused and cleared empties a catalogue.
   */
  const filters: Record<string, any> = {}
  for (const field of [
    "cloth_type",
    "pattern",
    "fabric_weight",
    "weave_or_knit",
    "primary_color",
    "source",
  ] as const) {
    const value = norm(q[field])
    if (value) filters[field] = value
  }

  const [rows, count] = await service.listAndCountTextileAnalyses(filters, {
    take: limit,
    skip: offset,
    order: { created_at: "DESC" },
    ...(norm(q.q) ? { q: String(q.q).trim() } : {}),
  })

  // ── Hydrate each row's media file ───────────────────────────────────────
  const ids = (rows ?? []).map((r: any) => r.id).filter(Boolean)
  const mediaByAnalysis = new Map<string, any>()

  // `filters: { id: [] }` is NO filter (#1433) — the empty case must not fall
  // through into reading every link on the platform.
  if (ids.length) {
    const { data: links = [] } = await query.graph({
      entity: mediaTextileAnalysisLink.entryPoint,
      fields: ["media_file_id", "textile_analysis_id"],
      filters: { textile_analysis_id: ids },
    })

    const mediaIds = Array.from(
      new Set((links as any[]).map((l) => l?.media_file_id).filter(Boolean))
    )

    if (mediaIds.length) {
      const files: any[] = await mediaService.listMediaFiles(
        { id: mediaIds },
        { take: mediaIds.length }
      )
      const fileById = new Map(files.map((f) => [f.id, f]))
      for (const l of links as any[]) {
        const file = fileById.get(l.media_file_id)
        if (file) mediaByAnalysis.set(l.textile_analysis_id, file)
      }
    }
  }

  res.json({
    textile_analyses: (rows ?? []).map((r: any) => ({
      ...r,
      media: mediaByAnalysis.get(r.id)
        ? {
            id: mediaByAnalysis.get(r.id).id,
            file_name: mediaByAnalysis.get(r.id).file_name,
            file_path: mediaByAnalysis.get(r.id).file_path,
            title: mediaByAnalysis.get(r.id).title,
          }
        : null,
    })),
    count,
    limit,
    offset,
  })
}
