import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { DESIGN_MODULE } from "../../../../../../modules/designs"
import type DesignService from "../../../../../../modules/designs/service"
import { ConstructionDetailBodySchema } from "../route"

/**
 * PATCH /admin/designs/:id/construction-details/:detailId
 * Update a construction detail (technique/label/params/fabricRules/note).
 */
export const PATCH = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id, detailId } = req.params

  const parsed = ConstructionDetailBodySchema.partial().safeParse(req.body)
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    )
  }
  const { technique, label, params, fabricRules, note } = parsed.data

  const designService = req.scope.resolve(DESIGN_MODULE) as DesignService

  const [existing] = await designService.listDesignSpecifications({
    id: detailId,
    design_id: id,
    category: "Construction",
  })
  if (!existing) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Construction detail ${detailId} not found on design ${id}`
    )
  }

  // Merge metadata so a partial update doesn't drop technique/params/fabricRules.
  const meta: Record<string, any> = { ...(existing.metadata ?? {}) }
  if (technique !== undefined) meta.technique = technique
  if (params !== undefined) {
    if (Object.keys(params).length) meta.params = params
    else delete meta.params
  }
  if (fabricRules !== undefined) {
    if (fabricRules.length) meta.fabricRules = fabricRules
    else delete meta.fabricRules
  }

  const updates: Record<string, any> = { id: detailId, metadata: meta }
  if (label !== undefined) updates.title = label
  if (note !== undefined) {
    updates.special_instructions = note || null
    if (note) updates.details = note
  }

  const updated = await designService.updateDesignSpecifications(updates)

  res.json({ construction_detail: updated })
}

/**
 * DELETE /admin/designs/:id/construction-details/:detailId
 */
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id, detailId } = req.params
  const designService = req.scope.resolve(DESIGN_MODULE) as DesignService

  const [existing] = await designService.listDesignSpecifications({
    id: detailId,
    design_id: id,
    category: "Construction",
  })
  if (!existing) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Construction detail ${detailId} not found on design ${id}`
    )
  }

  await designService.deleteDesignSpecifications(detailId)

  res.json({ id: detailId, object: "design_specification", deleted: true })
}
