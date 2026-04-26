import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { DESIGN_MODULE } from "../../../../../modules/designs"
import type DesignService from "../../../../../modules/designs/service"

/**
 * GET /admin/designs/:id/components
 * List all component designs that make up this bundle design.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id: parentDesignId } = req.params
  const designService = req.scope.resolve(DESIGN_MODULE) as DesignService

  const components = await designService.listDesignComponents(
    { parent_design_id: parentDesignId },
    { relations: ["component_design"] }
  )

  res.json({ components, count: components.length })
}

/**
 * POST /admin/designs/:id/components
 * Add a component design to this bundle design.
 *
 * Body: { component_design_id, quantity?, role?, notes?, order? }
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id: parentDesignId } = req.params
  const body = (req as any).validatedBody || req.body as any
  const { component_design_id, quantity = 1, role, notes, order = 0, metadata } = body

  if (!component_design_id) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "component_design_id is required")
  }

  if (component_design_id === parentDesignId) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "A design cannot be a component of itself")
  }

  const designService = req.scope.resolve(DESIGN_MODULE) as DesignService

  const [parent, component] = await Promise.all([
    designService.retrieveDesign(parentDesignId).catch(() => null),
    designService.retrieveDesign(component_design_id).catch(() => null),
  ])

  if (!parent) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Design ${parentDesignId} not found`)
  }
  if (!component) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Component design ${component_design_id} not found`)
  }

  const existing = await designService.listDesignComponents({
    parent_design_id: parentDesignId,
    component_design_id,
  })
  if (existing.length > 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Design ${component_design_id} is already a component of ${parentDesignId}`
    )
  }

  const created = await designService.createDesignComponents({
    parent_design_id: parentDesignId,
    component_design_id,
    quantity,
    role: role ?? null,
    notes: notes ?? null,
    order,
    metadata: metadata ?? null,
  })

  res.status(201).json({ component: created })
}
