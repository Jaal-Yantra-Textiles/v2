import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import type { Link } from "@medusajs/modules-sdk"

import { RAW_MATERIAL_MODULE } from "../../../modules/raw_material"
import {
  hasAttach,
  type ProposedLine,
} from "../../../modules/inventory_orders/lib/order-changes"

/**
 * #2659 — after approval has CREATED the items a partner proposed, put each
 * one where the admin said it belongs:
 *
 *   - a colour group: the item's raw material gets `group_id` — the same write
 *     as `POST /admin/raw-material-groups/:id/colors/link` (the MCP's
 *     `group_id` on add_inventory_raw_material is silently dropped; this is not
 *     that path). A `new_group_name` creates the group first.
 *   - a product variant: the variant → inventory item link with
 *     `required_quantity`, the same link core's
 *     `POST /admin/products/:id/variants/:variant_id/inventory-items` writes.
 *
 * Both are optional per item; an item with neither is left exactly as the
 * new_material path made it.
 *
 * The created line is found by `metadata.proposal_key`, which the line writer
 * records from the proposal's `key` — positional matching would attach the
 * wrong cloth the moment an admin dropped an item above it.
 *
 * 🔴 A requested link that cannot be made FAILS the approval (and the engine
 * rolls the created lines back), rather than approving with the item silently
 * unplaced: an admin who picked a group and finds the item outside it has no
 * way to tell that from never having picked one.
 */

const DEFAULT_GROUP_UNITS = new Set(["Meter", "Yard", "Kilogram", "Gram", "Piece", "Roll", "Other"])

type Compensation = {
  createdGroupIds: string[]
  regrouped: Array<{ id: string; prevGroupId: string | null }>
  variantLinks: Array<{ variant_id: string; inventory_item_id: string }>
}

export const attachApprovedNewItemsStep = createStep(
  "attach-approved-inventory-order-new-items",
  async (input: { orderId: string; lines: ProposedLine[] }, { container }) => {
    const wanted = (input.lines ?? []).filter(
      (l) => !l.id && !l.remove && l.key && hasAttach(l.attach)
    )
    const comp: Compensation = { createdGroupIds: [], regrouped: [], variantLinks: [] }
    if (!wanted.length) {
      return new StepResponse({ attached: 0 }, comp)
    }

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "inventory_orders",
      fields: [
        "id",
        "orderlines.id",
        "orderlines.metadata",
        "orderlines.inventory_items.id",
        "orderlines.inventory_items.raw_materials.id",
        "orderlines.inventory_items.raw_materials.group_id",
      ],
      filters: { id: input.orderId },
    })
    const byKey = new Map<string, { itemId: string; rawMaterial?: { id: string; group_id?: string | null } }>()
    for (const ol of (data?.[0]?.orderlines ?? []) as any[]) {
      const key = ol?.metadata?.proposal_key
      const item = (ol?.inventory_items ?? [])[0]
      if (!key || !item?.id) continue
      const rms = item.raw_materials
      const rm = Array.isArray(rms) ? rms[0] : rms
      byKey.set(String(key), { itemId: String(item.id), rawMaterial: rm?.id ? rm : undefined })
    }

    const rawMaterials: any = container.resolve(RAW_MATERIAL_MODULE)
    const link = container.resolve(ContainerRegistrationKeys.LINK) as Link

    for (const line of wanted) {
      const found = byKey.get(String(line.key))
      if (!found) {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          `Approved item "${line.new_material?.name}" was not found on order ${input.orderId}, so it could not be attached`
        )
      }
      const attach = line.attach!

      let groupId = attach.raw_material_group_id
      const newName = attach.new_group_name?.trim()
      if (!groupId && newName) {
        const unit = line.new_material?.unit_of_measure?.trim()
        const group = await rawMaterials.createRawMaterialGroups({
          name: newName,
          ...(unit && DEFAULT_GROUP_UNITS.has(unit) ? { unit_of_measure: unit } : {}),
          ...(line.new_material?.composition ? { composition: line.new_material.composition } : {}),
        })
        groupId = String(group.id)
        comp.createdGroupIds.push(groupId)
      }
      if (groupId) {
        if (!found.rawMaterial) {
          throw new MedusaError(
            MedusaError.Types.UNEXPECTED_STATE,
            `"${line.new_material?.name}" has no raw-material record, so it cannot join a colour group`
          )
        }
        comp.regrouped.push({ id: found.rawMaterial.id, prevGroupId: found.rawMaterial.group_id ?? null })
        await rawMaterials.updateRawMaterials([{ id: found.rawMaterial.id, group_id: groupId }])
      }

      if (attach.variant_id) {
        await link.create({
          [Modules.PRODUCT]: { variant_id: attach.variant_id },
          [Modules.INVENTORY]: { inventory_item_id: found.itemId },
          data: { required_quantity: attach.required_quantity ?? 1 },
        })
        comp.variantLinks.push({ variant_id: attach.variant_id, inventory_item_id: found.itemId })
      }
    }

    return new StepResponse({ attached: wanted.length }, comp)
  },
  async (comp: Compensation | undefined, { container }) => {
    if (!comp) return
    const link = container.resolve(ContainerRegistrationKeys.LINK) as Link
    const rawMaterials: any = container.resolve(RAW_MATERIAL_MODULE)
    for (const l of comp.variantLinks) {
      await link.dismiss({
        [Modules.PRODUCT]: { variant_id: l.variant_id },
        [Modules.INVENTORY]: { inventory_item_id: l.inventory_item_id },
      })
    }
    if (comp.regrouped.length) {
      await rawMaterials.updateRawMaterials(
        comp.regrouped.map((r) => ({ id: r.id, group_id: r.prevGroupId }))
      )
    }
    if (comp.createdGroupIds.length) {
      await rawMaterials.softDeleteRawMaterialGroups(comp.createdGroupIds)
    }
  }
)
