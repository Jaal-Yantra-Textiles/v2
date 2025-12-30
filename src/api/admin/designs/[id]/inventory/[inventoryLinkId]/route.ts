import {
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { AdminPatchDesignInventoryLinkReq } from "../validators"
import { DesignInventoryAllowedFields, refetchDesign } from "../helpers"
import { updateDesignInventoryLinkWorkflow } from "../../../../../../workflows/designs/inventory/link-inventory"

export const PATCH = async (
  req: MedusaRequest<AdminPatchDesignInventoryLinkReq>,
  res: MedusaResponse,
) => {
  const designId = req.params.id
  const { inventoryLinkId } = req.params as { inventoryLinkId: string }

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
    console.warn("Error reported at", errors)
    throw errors
  }

  const design = await refetchDesign(
    designId,
    req.scope,
    (req.queryConfig?.fields as DesignInventoryAllowedFields[]) || ["*"],
  )

  res.status(200).json(design)
}
