/**
 * @file Partner design ↔ inventory link update
 * @description Roadmap #6 Phase 2 — update a single BOM line
 * (planned quantity / location / metadata) on a partner-owned design.
 * Mirrors `PATCH /admin/designs/:id/inventory/:inventoryLinkId`.
 * @module API/Partners/Designs/Inventory
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import { updateDesignInventoryLinkWorkflow } from "../../../../../../workflows/designs/inventory/link-inventory"
import { listDesignInventoryWorkflow } from "../../../../../../workflows/designs/inventory/list-design-inventory"
import {
  assertPartnerOwnsDesign,
  getPartnerPrimaryStore,
} from "../../../helpers"
import { PartnerPatchDesignInventoryLinkReq } from "../validators"

export const PATCH = async (
  req: AuthenticatedMedusaRequest<PartnerPatchDesignInventoryLinkReq> & {
    params: { designId: string; inventoryLinkId: string }
  },
  res: MedusaResponse
) => {
  const { designId, inventoryLinkId } = req.params
  const { partner } = await assertPartnerOwnsDesign(req, designId)

  // If the partner moves the line to a location, it must be theirs.
  if (req.validatedBody.locationId) {
    const store = await getPartnerPrimaryStore(req, partner.id)
    const defaultLocationId = store?.default_location_id
    if (defaultLocationId && req.validatedBody.locationId !== defaultLocationId) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `location_id ${req.validatedBody.locationId} is not this partner's warehouse`
      )
    }
  }

  const { errors } = await updateDesignInventoryLinkWorkflow(req.scope).run({
    input: {
      design_id: designId,
      inventory_id: inventoryLinkId,
      planned_quantity: req.validatedBody.plannedQuantity,
      location_id: req.validatedBody.locationId,
      metadata: req.validatedBody.metadata ?? undefined,
    },
  })
  if (errors.length > 0) {
    throw errors
  }

  const { result } = await listDesignInventoryWorkflow(req.scope).run({
    input: { design_id: designId },
  })
  res.status(200).json(result)
}
