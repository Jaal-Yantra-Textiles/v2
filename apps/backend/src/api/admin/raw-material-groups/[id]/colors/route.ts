/**
 * API: /admin/raw-material-groups/:id/colors  (#817 S3)
 *
 * POST — add a color (a per-color raw_material) to the group: creates an
 *        inventory_item, creates the raw_material with `group_id` set, links
 *        them, and generates a SKU (reusing createRawMaterialWorkflow). Shared
 *        specs (composition / unit_of_measure / material_type) default from the
 *        group when omitted.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { createInventoryItemsWorkflow } from "@medusajs/medusa/core-flows"
import { RAW_MATERIAL_MODULE } from "../../../../../modules/raw_material"
import { createRawMaterialWorkflow } from "../../../../../workflows/raw-materials/create-raw-material"
import { AddGroupColor } from "../../validators"
import { refetchRawMaterialGroup } from "../../helpers"

export const POST = async (
  req: MedusaRequest<AddGroupColor>,
  res: MedusaResponse
) => {
  const { id: groupId } = req.params
  const body = req.validatedBody
  const service: any = req.scope.resolve(RAW_MATERIAL_MODULE)

  // Group must exist; pull shared specs to default from.
  const group = await service
    .retrieveRawMaterialGroup(groupId, { relations: ["material_type"] })
    .catch(() => null)
  if (!group) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Raw material group with id "${groupId}" not found`
    )
  }

  // 1) Create the inventory item for this color.
  const { result: created } = await createInventoryItemsWorkflow(req.scope).run({
    input: { items: [{ title: body.name }] },
  })
  const inventoryItem = ((created as any)?.items || (created as any) || [])[0]
  if (!inventoryItem?.id) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "Failed to create inventory item for the color"
    )
  }

  // 2) Create the per-color raw_material (with group_id) + link + SKU.
  //
  // #829 — inherit the group's global specs fill-blank: an explicit value on the
  // request wins; otherwise fall back to the group's value; otherwise leave unset.
  // width/weight/grade are intentionally NOT inherited (per-color).
  const inherit = <T,>(bodyVal: T | undefined | null, groupVal: T | undefined | null) =>
    bodyVal != null ? bodyVal : groupVal != null ? groupVal : undefined
  const opt = (key: string, value: unknown) =>
    value !== undefined && value !== null && value !== "" ? { [key]: value } : {}

  const rawMaterialData = {
    name: body.name,
    color: body.color,
    description: body.description ?? "",
    composition: body.composition ?? group.composition ?? "",
    unit_of_measure: body.unit_of_measure ?? group.unit_of_measure ?? "Other",
    ...(body.material_type_id
      ? { material_type_id: body.material_type_id }
      : group.material_type_id
        ? { material_type_id: group.material_type_id }
        : {}),
    ...opt("specifications", inherit(body.specifications, group.specifications)),
    ...opt("unit_cost", inherit(body.unit_cost, group.unit_cost)),
    ...opt("cost_currency", inherit(body.cost_currency, group.cost_currency)),
    ...opt("lead_time_days", inherit(body.lead_time_days, group.lead_time_days)),
    ...opt(
      "minimum_order_quantity",
      inherit(body.minimum_order_quantity, group.minimum_order_quantity)
    ),
    ...(body.metadata ? { metadata: body.metadata } : {}),
    ...(body.media ? { media: body.media } : {}),
    group_id: groupId,
  }

  await createRawMaterialWorkflow(req.scope).run({
    input: { inventoryId: inventoryItem.id, rawMaterialData },
  })

  // 3) Seed a zero-stock level at the group's default receiving location so the
  // color shares the same location as its siblings from the start (best-effort).
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
      // non-fatal — the color exists; a level can be seeded when it's ordered.
    }
  }

  const raw_material_group = await refetchRawMaterialGroup(groupId, req.scope)
  res.status(201).json({ raw_material_group })
}
