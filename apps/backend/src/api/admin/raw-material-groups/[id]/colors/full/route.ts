/**
 * API: /admin/raw-material-groups/:id/colors/full  (#817)
 *
 * POST — add a color capturing ALL material specs. Accepts the same
 *        `{ rawMaterialData }` envelope the shared RawMaterialForm submits:
 *        creates the inventory item, then runs createRawMaterialWorkflow with
 *        `group_id` injected (link + SKU + material_type handling included).
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { createInventoryItemsWorkflow } from "@medusajs/medusa/core-flows"
import { RAW_MATERIAL_MODULE } from "../../../../../../modules/raw_material"
import { createRawMaterialWorkflow } from "../../../../../../workflows/raw-materials/create-raw-material"
import { AddGroupColorFull } from "../../../validators"
import { refetchRawMaterialGroup } from "../../../helpers"

export const POST = async (
  req: MedusaRequest<AddGroupColorFull>,
  res: MedusaResponse
) => {
  const { id: groupId } = req.params
  const rawMaterialData = { ...(req.validatedBody.rawMaterialData as any) }

  const service: any = req.scope.resolve(RAW_MATERIAL_MODULE)
  const group = await service.retrieveRawMaterialGroup(groupId).catch(() => null)
  if (!group) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Raw material group with id "${groupId}" not found`
    )
  }

  const title = rawMaterialData.name || `${group.name} — ${rawMaterialData.color}`

  const { result: created } = await createInventoryItemsWorkflow(req.scope).run({
    input: { items: [{ title }] },
  })
  const inventoryItem = ((created as any)?.items || (created as any) || [])[0]
  if (!inventoryItem?.id) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "Failed to create inventory item for the color"
    )
  }

  await createRawMaterialWorkflow(req.scope).run({
    input: {
      inventoryId: inventoryItem.id,
      rawMaterialData: {
        // Sensible defaults inherited from the group when omitted.
        composition: group.composition ?? "",
        unit_of_measure: group.unit_of_measure ?? "Other",
        ...rawMaterialData,
        name: title,
        group_id: groupId,
      },
    },
  })

  const raw_material_group = await refetchRawMaterialGroup(groupId, req.scope)
  res.status(201).json({ raw_material_group })
}
