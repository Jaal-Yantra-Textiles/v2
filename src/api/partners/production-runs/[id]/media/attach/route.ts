import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { PRODUCTION_RUNS_MODULE } from "../../../../../../modules/production_runs"
import type ProductionRunService from "../../../../../../modules/production_runs/service"
import { updateDesignWorkflow } from "../../../../../../workflows/designs/update-design"
import { listSingleDesignsWorkflow } from "../../../../../../workflows/designs/list-single-design"

const attachMediaSchema = z.object({
  media_files: z
    .array(
      z.object({
        id: z.string().optional(),
        url: z.string().min(1),
        isThumbnail: z.boolean().optional().default(false),
      })
    )
    .min(1),
  metadata: z.record(z.any()).optional(),
})

export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const partnerId = req.auth_context?.actor_id
  if (!partnerId) {
    return res.status(401).json({ error: "Partner authentication required" })
  }

  const id = req.params.id

  const productionRunService: ProductionRunService =
    req.scope.resolve(PRODUCTION_RUNS_MODULE)

  const run = await productionRunService
    .retrieveProductionRun(id)
    .catch(() => null)

  if (!run || (run as any).partner_id !== partnerId) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Production run ${id} not found`
    )
  }

  const designId = (run as any).design_id
  if (!designId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Production run has no design linked"
    )
  }

  const parsed = attachMediaSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      parsed.error.errors.map((e) => e.message).join(", ")
    )
  }

  const { media_files, metadata: mergedMeta } = parsed.data

  // Find thumbnail
  const thumbnailFile = media_files.find((f) => f.isThumbnail)
  const thumbnail = thumbnailFile?.url || null

  // Fetch current design media
  const { result: currentDesign } = await listSingleDesignsWorkflow(
    req.scope
  ).run({
    input: { id: designId, fields: ["*"] },
  })

  const existing = (currentDesign as any)?.media_files || []
  const existingMeta = (currentDesign as any)?.metadata || {}

  // De-duplicate by key
  const byKey = new Map<string, any>()
  for (const m of existing) {
    const key = m.id ? `id:${m.id}` : m.url ? `url:${m.url}` : `r:${Math.random()}`
    byKey.set(key, m)
  }
  for (const m of media_files) {
    const key = m.id ? `id:${m.id}` : `url:${m.url}`
    byKey.set(key, m)
  }

  const mergedMedia = Array.from(byKey.values()).map((m: any) => ({
    ...m,
    isThumbnail: thumbnail ? m.url === thumbnail : !!m.isThumbnail,
  }))

  const nextMetadata = {
    ...existingMeta,
    ...(mergedMeta || {}),
    ...(thumbnail ? { thumbnail } : {}),
  }

  const { errors } = await updateDesignWorkflow(req.scope).run({
    input: {
      id: designId,
      media_files: mergedMedia,
      metadata: nextMetadata,
    },
  })

  if (errors?.length) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "Failed to attach media"
    )
  }

  const { result: updated } = await listSingleDesignsWorkflow(req.scope).run({
    input: { id: designId, fields: ["*"] },
  })

  return res.status(200).json({
    message: "Media attached successfully",
    design: updated,
  })
}
