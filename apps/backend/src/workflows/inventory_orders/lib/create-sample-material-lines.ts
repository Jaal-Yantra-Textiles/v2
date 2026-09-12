import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"

import { createRawMaterialWorkflow } from "../../raw-materials/create-raw-material"

/**
 * Create the inventory items for order lines that name a material we have
 * never stocked.
 *
 * This exists for samples/swatch orders. A swatch is very often cloth with no
 * catalogue entry yet — that is the point of asking for it — so the line has no
 * `inventory_item_id` and no `variant_id` to give. Requiring one first would
 * mean walking away from an open box to go create a catalogue record, which is
 * precisely when the colour name and the composition get lost.
 *
 * The item is created and its raw-material record attached in one go, so the
 * line comes out the same shape as every other line and nothing downstream has
 * to know it was born here. `createRawMaterialWorkflow` also assigns the SKU.
 *
 * ⚠️ No inventory LEVEL is seeded and no stock is posted. A swatch is reference
 * material, not sellable stock; banking it would put zero-value units into a
 * location where they can be counted, reserved and sold.
 */

export type NewMaterialInput = {
  name: string
  color?: string
  composition?: string
  unit_of_measure?: string
}

export type MaterialLine = {
  id?: string
  remove?: boolean
  inventory_item_id?: string
  variant_id?: string
  new_material?: NewMaterialInput
}

/**
 * PURE: which lines are asking for a new material to be created?
 *
 * Only NEW lines (no `id`), never removals, and never a line that already
 * points at something — creating an item beside one the operator picked would
 * silently duplicate the catalogue entry.
 *
 * Returns positional indexes so the caller can write the resulting item ids
 * back onto the exact lines they came from.
 */
export function planNewMaterialLines(
  lines: MaterialLine[]
): Array<{ index: number; material: NewMaterialInput }> {
  const plan: Array<{ index: number; material: NewMaterialInput }> = []
  lines.forEach((line, index) => {
    if (line.remove || line.id) return
    if (line.inventory_item_id || line.variant_id) return
    const name = line.new_material?.name?.trim()
    if (!name) return
    plan.push({ index, material: { ...line.new_material!, name } })
  })
  return plan
}

/**
 * PURE: the inventory item title for a named material.
 *
 * Colour is folded into the title because two swatches of the same cloth in
 * different colours are different stock, and a catalogue of six items all
 * called "Tangaliya Weave" cannot be told apart in a picker.
 */
export function materialItemTitle(material: NewMaterialInput): string {
  const name = material.name.trim()
  const color = material.color?.trim()
  return color ? `${name} — ${color}` : name
}

/**
 * Create an inventory item + raw material for each planned line and return the
 * new item id by line index.
 */
export async function createMaterialsForLines(
  container: MedusaContainer,
  lines: MaterialLine[]
): Promise<Map<number, string>> {
  const created = new Map<number, string>()
  const plan = planNewMaterialLines(lines)
  if (!plan.length) return created

  const inventoryService: any = container.resolve(Modules.INVENTORY)
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)

  for (const { index, material } of plan) {
    const title = materialItemTitle(material)

    const [item] = await inventoryService.createInventoryItems([
      {
        title,
        // No SKU here — `createRawMaterialWorkflow` generates one, and a
        // placeholder would have to be unique across the whole catalogue.
        requires_shipping: true,
      },
    ])

    if (!item?.id) {
      throw new Error(
        `Could not create an inventory item for the new material "${title}".`
      )
    }

    try {
      await createRawMaterialWorkflow(container as any).run({
        input: {
          inventoryId: item.id,
          rawMaterialData: {
            name: material.name.trim(),
            // `composition` is required by the raw-material model; a swatch is
            // frequently requested precisely because nobody knows it yet, so an
            // empty string records "not stated" rather than blocking the line.
            composition: material.composition?.trim() || "",
            ...(material.color ? { color: material.color.trim() } : {}),
            ...(material.unit_of_measure
              ? { unit_of_measure: material.unit_of_measure.trim() }
              : {}),
          },
        },
      })
    } catch (e: any) {
      // The item exists and the line can reference it. Losing the descriptive
      // record is worth a loud warning, not the loss of what arrived in the box.
      logger.warn(
        `[inventory-order] inventory item ${item.id} created for "${title}" but its raw-material record failed: ${e?.message}`
      )
    }

    created.set(index, String(item.id))
  }

  return created
}
