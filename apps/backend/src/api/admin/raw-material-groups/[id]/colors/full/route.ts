/**
 * API: /admin/raw-material-groups/:id/colors/full  (#817)
 *
 * POST — add a color capturing ALL material specs. Accepts the same
 *        `{ rawMaterialData }` envelope the shared RawMaterialForm submits:
 *        creates the inventory item, then runs createRawMaterialWorkflow with
 *        `group_id` injected (link + SKU + material_type handling included).
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, Modules } from "@medusajs/framework/utils"
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

  // #829 — group globals as defaults; the form's explicit values (spread after)
  // win, so the group only fills the fields the form left out (fill-blank).
  const groupDefaults: Record<string, unknown> = {
    composition: group.composition ?? "",
    unit_of_measure: group.unit_of_measure ?? "Other",
  }
  const withDefault = (key: string, value: unknown) => {
    if (value !== undefined && value !== null && value !== "") {
      groupDefaults[key] = value
    }
  }
  withDefault("specifications", group.specifications)
  withDefault("material_type_id", group.material_type_id)
  withDefault("unit_cost", group.unit_cost)
  withDefault("cost_currency", group.cost_currency)
  withDefault("lead_time_days", group.lead_time_days)
  withDefault("minimum_order_quantity", group.minimum_order_quantity)

  await createRawMaterialWorkflow(req.scope).run({
    input: {
      inventoryId: inventoryItem.id,
      rawMaterialData: {
        ...groupDefaults,
        ...rawMaterialData,
        // `description` is required on the model; the spec form leaves it
        // optional, so default it here (same as the quick-add /colors route).
        description: rawMaterialData.description ?? "",
        name: title,
        group_id: groupId,
      },
    },
  })

  // Seed a zero-stock level at the group's default receiving location (#829).
  if (group.stock_location_id) {
    try {
      const inventoryService: any = req.scope.resolve(Modules.INVENTORY)
      await inventoryService.createInventoryLevels([
        {
          inventory_item_id: inventoryItem.id,
          location_id: group.stock_location_id,
          stocked_quantity: 0,
          incoming_quantity: 0,
        },
      ])
    } catch {
      // non-fatal.
    }
  }

  const raw_material_group = await refetchRawMaterialGroup(groupId, req.scope)
  res.status(201).json({ raw_material_group })
}
