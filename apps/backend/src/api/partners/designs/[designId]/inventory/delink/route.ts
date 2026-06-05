/**
 * @file Partner design ↔ inventory delink
 * @description Roadmap #6 Phase 2 — remove BOM lines from a
 * partner-owned design. Mirrors `DELETE /admin/designs/:id/inventory/delink`.
 * @module API/Partners/Designs/Inventory
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { delinkDesignInventoryWorkflow } from "../../../../../../workflows/designs/inventory/link-inventory"
import { listDesignInventoryWorkflow } from "../../../../../../workflows/designs/inventory/list-design-inventory"
import { assertPartnerOwnsDesign } from "../../../helpers"
import { PartnerDeleteDesignInventoryReq } from "../validators"

export const DELETE = async (
  req: AuthenticatedMedusaRequest<PartnerDeleteDesignInventoryReq> & {
    params: { designId: string }
  },
  res: MedusaResponse
) => {
  const { designId } = req.params
  await assertPartnerOwnsDesign(req, designId)

  const { errors } = await delinkDesignInventoryWorkflow(req.scope).run({
    input: {
      design_id: designId,
      inventory_ids: req.validatedBody.inventoryIds,
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
