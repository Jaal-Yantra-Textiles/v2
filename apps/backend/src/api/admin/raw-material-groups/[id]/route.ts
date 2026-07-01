/**
 * API: /admin/raw-material-groups/:id  (#817 S3)
 *
 * GET — a group with its per-color raw_materials and each color's linked
 *       inventory_item (id/sku). Feeds the group-ordering UI.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { refetchRawMaterialGroup } from "../helpers"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const raw_material_group = await refetchRawMaterialGroup(id, req.scope)
  res.status(200).json({ raw_material_group })
}
