import { useMemo, useState } from "react"
import {
  Button,
  Checkbox,
  Input,
  Label,
  Popover,
  Switch,
  Text,
  toast,
} from "@medusajs/ui"
import { sdk } from "../../lib/config"
import { useRawMaterialGroups } from "../../hooks/api/raw-material-groups"
import type { RawMaterialGroup } from "../../hooks/api/raw-material-groups"
import {
  expandGroupsToBatchLines,
  summarizeExpansion,
  type BatchLineToAdd,
} from "./group-batch-helpers"

// Kept for backwards compatibility with earlier callers; the batch fields are
// additive so the append() sites don't need to change.
export type GroupLineToAdd = BatchLineToAdd

interface AddMaterialGroupControlProps {
  /**
   * inventory_item_ids already present in the order-lines form — group members
   * matching these are skipped (summed mode) so re-selecting a group never
   * duplicates a line.
   */
  existingItemIds: string[]
  /** Called with the resolved lines the parent should append to its field array. */
  onAdd: (lines: GroupLineToAdd[]) => void
  disabled?: boolean
}

/**
 * "Add by Material Group" for the inventory order-lines picker — now supports
 * MASS BATCHES: pick several groups at once, choose a batch count N, and decide
 * whether the batches collapse into one line per color (summed) or stay as N
 * separate, individually-trackable lines (see group-batch-helpers).
 *
 * Group detail (per-color members + their inventory items) is fetched on demand
 * for the selected groups when "Add" is pressed — the list endpoint doesn't
 * carry the linked inventory items. Colors without an inventory item yet are
 * skipped (the create flow needs a concrete inventory_item_id) and surfaced in
 * the toast rather than silently dropped.
 */
export const AddMaterialGroupControl = ({
  existingItemIds,
  onAdd,
  disabled,
}: AddMaterialGroupControlProps) => {
  const { data, isLoading } = useRawMaterialGroups({ limit: 100 })
  const groups = data?.raw_material_groups ?? []

  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [batches, setBatches] = useState(1)
  const [keepSeparate, setKeepSeparate] = useState(false)
  const [busy, setBusy] = useState(false)

  const selectedIds = useMemo(
    () => Object.keys(selected).filter((id) => selected[id]),
    [selected]
  )

  const reset = () => {
    setSelected({})
    setBatches(1)
    setKeepSeparate(false)
  }

  const handleAdd = async () => {
    if (!selectedIds.length) {
      return
    }
    setBusy(true)
    try {
      // Fetch each selected group's detail (colors + linked inventory items).
      const details = await Promise.all(
        selectedIds.map((id) =>
          sdk.client
            .fetch<{ raw_material_group: RawMaterialGroup }>(
              `/admin/raw-material-groups/${id}`
            )
            .then((r) => r.raw_material_group)
            .catch(() => null)
        )
      )
      const resolvedGroups = details.filter(Boolean) as RawMaterialGroup[]
      if (!resolvedGroups.length) {
        toast.error("Could not load the selected group(s)")
        return
      }

      const { lines, summary } = expandGroupsToBatchLines({
        groups: resolvedGroups.map((g) => ({
          name: g.name,
          minimum_order_quantity: g.minimum_order_quantity ?? null,
          unit_cost: g.unit_cost ?? null,
          raw_materials: (g.raw_materials ?? []).map((c) => ({
            inventory_item: c.inventory_item ?? null,
          })),
        })),
        existingItemIds,
        batches,
        keepSeparate,
      })

      if (lines.length) {
        onAdd(lines)
      }
      const msg = summarizeExpansion(summary, resolvedGroups.length)
      if (lines.length) {
        toast.success(msg)
      } else {
        toast.info(msg)
      }

      reset()
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  const triggerDisabled = disabled || isLoading || groups.length === 0

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button size="small" variant="secondary" type="button" disabled={triggerDisabled}>
          {groups.length === 0 ? "No material groups" : "Add material groups…"}
        </Button>
      </Popover.Trigger>
      <Popover.Content className="w-80 p-0" align="end">
        <div className="flex flex-col">
          <div className="max-h-64 overflow-y-auto p-3">
            {groups.length === 0 ? (
              <Text size="small" className="text-ui-fg-subtle">
                No material groups yet.
              </Text>
            ) : (
              <div className="flex flex-col gap-y-2">
                {groups.map((group) => {
                  const count = group.raw_materials?.length
                  return (
                    <label
                      key={group.id}
                      className="flex items-center gap-x-2 cursor-pointer"
                    >
                      <Checkbox
                        checked={!!selected[group.id]}
                        onCheckedChange={(v) =>
                          setSelected((s) => ({ ...s, [group.id]: !!v }))
                        }
                      />
                      <Text size="small" className="flex-1">
                        {group.name}
                        {count ? (
                          <span className="text-ui-fg-subtle">{` (${count})`}</span>
                        ) : (
                          ""
                        )}
                      </Text>
                    </label>
                  )
                })}
              </div>
            )}
          </div>

          <div className="border-t border-ui-border-base p-3 flex flex-col gap-y-3">
            <div className="flex items-center justify-between">
              <Label size="small" htmlFor="mg-batches" weight="plus">
                Batches
              </Label>
              <Input
                id="mg-batches"
                type="number"
                min={1}
                className="w-20"
                size="small"
                value={batches}
                onChange={(e) =>
                  setBatches(Math.max(1, Math.floor(Number(e.target.value) || 1)))
                }
              />
            </div>

            <div className="flex items-center justify-between gap-x-2">
              <div className="flex flex-col">
                <Label size="small" htmlFor="mg-separate" weight="plus">
                  Keep batches as separate lines
                </Label>
                <Text size="xsmall" className="text-ui-fg-subtle">
                  {keepSeparate
                    ? "One line per batch (trackable)"
                    : "Summed into one line per color"}
                </Text>
              </div>
              <Switch
                id="mg-separate"
                checked={keepSeparate}
                onCheckedChange={setKeepSeparate}
              />
            </div>

            <Button
              size="small"
              type="button"
              onClick={handleAdd}
              disabled={!selectedIds.length || busy}
              isLoading={busy}
            >
              {selectedIds.length
                ? `Add ${selectedIds.length} ${
                    selectedIds.length === 1 ? "group" : "groups"
                  }`
                : "Select groups"}
            </Button>
          </div>
        </div>
      </Popover.Content>
    </Popover>
  )
}
