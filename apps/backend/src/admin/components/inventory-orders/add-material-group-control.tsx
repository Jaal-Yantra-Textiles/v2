import { useEffect, useState } from "react"
import { Select, toast } from "@medusajs/ui"
import {
  useRawMaterialGroups,
  useRawMaterialGroup,
} from "../../hooks/api/raw-material-groups"

export type GroupLineToAdd = {
  inventory_item_id: string
  quantity: number
  price: number
}

interface AddMaterialGroupControlProps {
  /**
   * inventory_item_ids already present in the order-lines form — group members
   * matching these are skipped so re-selecting a group never duplicates a line.
   */
  existingItemIds: string[]
  /** Called with the resolved lines the parent should append to its field array. */
  onAdd: (lines: GroupLineToAdd[]) => void
  disabled?: boolean
}

/**
 * #846 — "add by Material Group" for the inventory order-lines picker. Selecting
 * a group fans out ALL of its per-color members that already have an inventory
 * item into order lines in one action, pre-filling quantity (group MOQ, else 1)
 * and price (group unit_cost, else 0) — both still editable in the grid.
 *
 * Colors that don't have an inventory item yet are skipped here (the create flow
 * needs a concrete inventory_item_id); the group-order endpoint's fan-out
 * (resolveGroupColorInventoryItemsWorkflow) is the path that auto-creates those,
 * so we surface a count rather than silently dropping them.
 */
export const AddMaterialGroupControl = ({
  existingItemIds,
  onAdd,
  disabled,
}: AddMaterialGroupControlProps) => {
  const { data, isLoading } = useRawMaterialGroups({ limit: 100 })
  const groups = data?.raw_material_groups ?? []

  // Two-step: pick a group -> fetch its detail (colors + linked items) -> add.
  const [pendingId, setPendingId] = useState<string | null>(null)
  const { data: detail, isFetching } = useRawMaterialGroup(pendingId ?? undefined)

  useEffect(() => {
    if (!pendingId) {
      return
    }
    const group = detail?.raw_material_group
    if (!group || group.id !== pendingId) {
      return
    }

    const existing = new Set(existingItemIds)
    const colors = group.raw_materials ?? []
    const quantity =
      group.minimum_order_quantity && group.minimum_order_quantity > 0
        ? group.minimum_order_quantity
        : 1
    const price = typeof group.unit_cost === "number" ? group.unit_cost : 0

    const toAdd: GroupLineToAdd[] = []
    let skippedNoItem = 0
    let skippedDuplicate = 0
    for (const color of colors) {
      const inventoryItemId = color.inventory_item?.id
      if (!inventoryItemId) {
        skippedNoItem++
        continue
      }
      if (existing.has(inventoryItemId)) {
        skippedDuplicate++
        continue
      }
      existing.add(inventoryItemId)
      toAdd.push({ inventory_item_id: inventoryItemId, quantity, price })
    }

    if (toAdd.length) {
      onAdd(toAdd)
    }

    const summary = [
      `Added ${toAdd.length} ${toAdd.length === 1 ? "color" : "colors"} from “${group.name}”`,
    ]
    if (skippedDuplicate) {
      summary.push(`${skippedDuplicate} already in the order`)
    }
    if (skippedNoItem) {
      summary.push(`${skippedNoItem} without a stock item yet`)
    }
    if (toAdd.length) {
      toast.success(summary.join(" · "))
    } else {
      toast.info(summary.join(" · "))
    }

    setPendingId(null)
  }, [detail, pendingId, existingItemIds, onAdd])

  return (
    <Select
      size="small"
      value=""
      onValueChange={(value) => setPendingId(value)}
      disabled={disabled || isLoading || isFetching || groups.length === 0}
    >
      <Select.Trigger className="min-w-[200px]">
        <Select.Value
          placeholder={
            groups.length === 0
              ? "No material groups"
              : isFetching
                ? "Adding…"
                : "Add a material group…"
          }
        />
      </Select.Trigger>
      <Select.Content>
        {groups.map((group) => {
          const count = group.raw_materials?.length
          return (
            <Select.Item key={group.id} value={group.id}>
              {group.name}
              {count ? ` (${count})` : ""}
            </Select.Item>
          )
        })}
      </Select.Content>
    </Select>
  )
}
