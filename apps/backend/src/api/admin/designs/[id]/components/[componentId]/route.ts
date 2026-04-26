import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { DESIGN_MODULE } from "../../../../../../modules/designs"
import type DesignService from "../../../../../../modules/designs/service"

/**
 * PATCH /admin/designs/:id/components/:componentId
 * Update a component link (quantity, role, notes, order).
 */
export const PATCH = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id: parentDesignId, componentId } = req.params
  const body = (req as any).validatedBody || req.body as any
  const designService = req.scope.resolve(DESIGN_MODULE) as DesignService

  const existing = await designService.listDesignComponents({
    id: componentId,
    parent_design_id: parentDesignId,
  })

  if (!existing.length) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Component link ${componentId} not found`)
  }

  const updates: Record<string, any> = {}
  if (body.quantity !== undefined) updates.quantity = body.quantity
  if (body.role !== undefined) updates.role = body.role
  if (body.notes !== undefined) updates.notes = body.notes
  if (body.order !== undefined) updates.order = body.order
  if (body.metadata !== undefined) updates.metadata = body.metadata

  const updated = await designService.updateDesignComponents({ id: componentId }, updates)

  res.json({ component: updated })
}

/**
 * DELETE /admin/designs/:id/components/:componentId
 * Remove a component from this bundle design.
 */
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id: parentDesignId, componentId } = req.params
  const designService = req.scope.resolve(DESIGN_MODULE) as DesignService

  const existing = await designService.listDesignComponents({
    id: componentId,
    parent_design_id: parentDesignId,
  })

  if (!existing.length) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Component link ${componentId} not found`)
  }

  await designService.deleteDesignComponents(componentId)

  res.json({ id: componentId, object: "design_component", deleted: true })
}
