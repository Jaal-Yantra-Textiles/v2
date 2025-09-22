"use client"

import { useState } from "react"
import { Button, FocusModal, Heading, Input, Text } from "@medusajs/ui"

type ConsumptionRow = { inventory_item_id: string; quantity: number }
type LinkedItem = {
  id: string
  title?: string | null
  raw_materials?: { name?: string | null } | null
  location_levels?: Array<{
    stocked_quantity?: number
    available_quantity?: number
    stock_locations?: Array<{ id: string; name?: string | null }>
  }>
}

export default function CompleteDesignModal({
  completeAction,
  items,
}: {
  completeAction: (formData: FormData) => Promise<void>
  items?: LinkedItem[]
}) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<ConsumptionRow[]>([{ inventory_item_id: "", quantity: 1 }])
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [error, setError] = useState<string | null>(null)

  const addRow = () => setRows((r) => [...r, { inventory_item_id: "", quantity: 1 }])
  const removeRow = (idx: number) => setRows((r) => r.filter((_, i) => i !== idx))
  const updateRow = (idx: number, key: keyof ConsumptionRow, value: string) => {
    setRows((r) => r.map((row, i) => (i === idx ? { ...row, [key]: key === "quantity" ? Number(value || 0) : value } : row)))
  }

  return (
    <>
      <Button className="w-full sm:w-auto" variant="primary" onClick={() => setOpen(true)}>Complete</Button>
      <FocusModal open={open} onOpenChange={setOpen}>
        
        <FocusModal.Content className="z-50 max-w-xl w-[92vw] sm:w-full mx-auto my-6 sm:my-8">
          <FocusModal.Header>
            <Heading>Complete Design</Heading>
          </FocusModal.Header>
          <FocusModal.Body className="max-h-[80vh] overflow-y-auto">
            <div className="flex flex-col gap-4 p-2 sm:p-4">
              <Text size="small" className="text-ui-fg-subtle">
                Optionally specify inventory consumptions to deduct per inventory item. If left empty, the system will apply defaults.
              </Text>
              <form
                action={async (formData) => {
                  setError(null)
                  if (Array.isArray(items) && items.length) {
                    // Validate against first level availability
                    const arr = items
                      .map((it) => {
                        const lvl = it.location_levels && it.location_levels.length ? it.location_levels[0] : undefined
                        const available = typeof lvl?.available_quantity === "number" ? lvl.available_quantity : (typeof lvl?.stocked_quantity === "number" ? lvl.stocked_quantity : 0)
                        const q = Number(quantities[it.id] || 0)
                        return { inventory_item_id: it.id, quantity: q, available }
                      })
                      .filter((r) => r.inventory_item_id && r.quantity > 0)

                    const over = arr.find((r) => r.quantity > (r.available ?? 0))
                    if (over) {
                      setError(`Quantity exceeds available for item ${over.inventory_item_id}. Available: ${over.available}`)
                      return
                    }

                    const payload = arr.map(({ inventory_item_id, quantity }) => ({ inventory_item_id, quantity }))
                    if (arr.length > 0) {
                      formData.set("consumptions", JSON.stringify(payload))
                    }
                  } else {
                    const filtered = rows.filter((r) => r.inventory_item_id && (r.quantity ?? 0) > 0)
                    if (filtered.length > 0) {
                      formData.set("consumptions", JSON.stringify(filtered))
                    }
                  }
                  await completeAction(formData)
                }}
                className="flex flex-col gap-4"
              >
                {Array.isArray(items) && items.length ? (
                  <div className="flex flex-col gap-3">
                    {items.map((it) => {
                      const lvl = it.location_levels && it.location_levels.length ? it.location_levels[0] : undefined
                      const locName = lvl?.stock_locations && lvl.stock_locations.length ? (lvl.stock_locations[0]?.name || lvl.stock_locations[0]?.id) : undefined
                      const available = typeof lvl?.available_quantity === "number" ? lvl.available_quantity : (typeof lvl?.stocked_quantity === "number" ? lvl.stocked_quantity : 0)
                      return (
                        <div key={it.id} className="grid grid-cols-12 gap-2 items-end">
                          <div className="col-span-8">
                            <label className="block mb-1 text-sm">{it.title || it.id}</label>
                            <Text size="xsmall" className="text-ui-fg-muted">{it.raw_materials?.name}</Text>
                            <Text size="xsmall" className="text-ui-fg-subtle">Available: {available ?? 0}{locName ? ` @ ${locName}` : ""}</Text>
                          </div>
                          <div className="col-span-4">
                            <label className="block mb-1 text-sm">Quantity</label>
                            <Input
                              type="number"
                              step="any"
                              value={String(quantities[it.id] ?? 0)}
                              onChange={(e) => setQuantities((q) => ({ ...q, [it.id]: Number(e.target.value || 0) }))}
                              inputMode="decimal"
                              placeholder="0"
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {rows.map((row, idx) => (
                      <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                        <div className="col-span-7">
                          <label className="block mb-1 text-sm">Inventory Item ID</label>
                          <Input
                            value={row.inventory_item_id}
                            onChange={(e) => updateRow(idx, "inventory_item_id", e.target.value)}
                            placeholder="iitem_..."
                          />
                        </div>
                        <div className="col-span-3">
                          <label className="block mb-1 text-sm">Quantity</label>
                          <Input
                            type="number"
                            step="any"
                            value={String(row.quantity ?? 1)}
                            onChange={(e) => updateRow(idx, "quantity", e.target.value)}
                            inputMode="decimal"
                            placeholder="1"
                          />
                        </div>
                        <div className="col-span-2 flex gap-2">
                          <Button type="button" variant="secondary" onClick={() => addRow()}>Add</Button>
                          {rows.length > 1 && (
                            <Button type="button" variant="danger" onClick={() => removeRow(idx)}>Remove</Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-center justify-end gap-2">
                  <Button variant="secondary" type="button" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button variant="primary" type="submit">Confirm & Complete</Button>
                </div>
                {error && (
                  <Text size="xsmall" className="text-ui-tag-red-icon">{error}</Text>
                )}
              </form>
            </div>
          </FocusModal.Body>
        </FocusModal.Content>
      </FocusModal>
    </>
  )
}
