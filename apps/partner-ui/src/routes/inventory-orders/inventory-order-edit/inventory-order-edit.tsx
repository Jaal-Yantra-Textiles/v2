import { Button, Checkbox, Heading, Input, Label, Text, toast } from "@medusajs/ui"
import { useEffect, useMemo, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"

import { RouteDrawer, useRouteModal } from "../../../components/modals"
import { ordersQueryKeys } from "../../../hooks/api/orders"
import {
  usePartnerAddInventoryOrderCharge,
  usePartnerInventoryOrder,
  usePartnerUpdateInventoryOrderLines,
} from "../../../hooks/api/partner-inventory-orders"
import { useInventoryActionTarget } from "../../../hooks/use-inventory-action-target"

type EditableLine = {
  id: string
  label: string
  quantity: number
  price: number
  remove: boolean
}

/**
 * #1752 — the partner proposes line edits/removals and a `tax` charge. This
 * drawer STAGES the proposal (nothing applies until an admin approves); the
 * header action menu then locks the order's other actions until it is resolved.
 */
export const InventoryOrderEdit = () => {
  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <RouteDrawer.Title asChild>
          <Heading>Edit lines & tax</Heading>
        </RouteDrawer.Title>
        <RouteDrawer.Description className="sr-only">
          Propose changes to the inventory order
        </RouteDrawer.Description>
      </RouteDrawer.Header>
      <InventoryOrderEditContent />
    </RouteDrawer>
  )
}

const InventoryOrderEditContent = () => {
  const { inventoryOrderId: id, unifiedOrderId } = useInventoryActionTarget()
  const { handleSuccess } = useRouteModal()
  const queryClient = useQueryClient()

  const { inventoryOrder } = usePartnerInventoryOrder(id || "", { enabled: !!id })
  const { mutateAsync: updateLines, isPending: isUpdatingLines } =
    usePartnerUpdateInventoryOrderLines(id || "")
  const { mutateAsync: addCharge, isPending: isAddingCharge } =
    usePartnerAddInventoryOrderCharge(id || "")

  const [lines, setLines] = useState<EditableLine[] | null>(null)
  const [taxAmount, setTaxAmount] = useState("")
  const [taxNote, setTaxNote] = useState("")

  /**
   * Seed the form once the order arrives (idempotent — only before first edit).
   *
   * 🔴 An EFFECT, not a useMemo. This was a `useMemo` whose only job was to call
   * `setLines` and whose return value nobody read — i.e. a state update during
   * render. React is free to discard or re-run a memo, and under StrictMode it
   * runs twice, so the seed was never guaranteed to happen exactly once. The
   * unused-variable error was the symptom; rendering a side effect was the bug.
   */
  useEffect(() => {
    if (lines !== null || !inventoryOrder) return
    const rows = (inventoryOrder.order_lines ?? []).map((l: any) => ({
      id: String(l.id),
      label:
        l.material_name ||
        l.inventory_items?.[0]?.title ||
        l.inventory_items?.[0]?.name ||
        String(l.id),
      quantity: Number(l.quantity) || 0,
      price: Number(l.price) || 0,
      remove: false,
    }))
    setLines(rows)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inventoryOrder, lines])

  const setLine = (idx: number, patch: Partial<EditableLine>) => {
    setLines((prev) =>
      prev ? prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)) : prev
    )
  }

  const handleSave = async () => {
    if (!id || !lines) return
    const tax = Number(taxAmount)
    const orderLines = lines.map((l) =>
      l.remove
        ? { id: l.id, remove: true }
        : { id: l.id, quantity: l.quantity, price: l.price }
    )

    await updateLines(
      { order_lines: orderLines },
      {
        onSuccess: async () => {
          if (tax > 0) {
            await addCharge(
              { type: "tax", amount: tax, note: taxNote || undefined },
              {
                onError: (e) => {
                  toast.error(e.message)
                },
              }
            )
          }
          toast.success("Changes proposed — awaiting approval")
          if (unifiedOrderId) {
            queryClient.invalidateQueries({
              queryKey: ordersQueryKeys.detail(unifiedOrderId),
            })
          }
          handleSuccess()
        },
        onError: (e) => {
          toast.error(e.message)
        },
      }
    )
  }

  const isBusy = isUpdatingLines || isAddingCharge

  return (
    <>
      <RouteDrawer.Body>
        {!id ? (
          <Text size="small" className="text-ui-fg-subtle">
            Missing inventory order id.
          </Text>
        ) : !lines ? (
          <Text size="small" className="text-ui-fg-subtle">
            Loading…
          </Text>
        ) : (
          <div className="flex flex-col gap-y-6">
            <div>
              <Text size="small" className="text-ui-fg-subtle">
                Change a quantity or price, tick a line to remove it. Your changes
                are proposed, not applied — they take effect only once approved.
              </Text>
            </div>

            <div className="flex flex-col gap-y-4">
              {lines.map((line, idx) => (
                <div
                  key={line.id}
                  className="flex flex-col gap-y-2 rounded-lg border border-ui-border-base p-3"
                >
                  <div className="flex items-center gap-x-3">
                    <Checkbox
                      checked={line.remove}
                      onCheckedChange={(v) =>
                        setLine(idx, { remove: v === true })
                      }
                    />
                    <Text
                      size="small"
                      weight="plus"
                      className={line.remove ? "line-through text-ui-fg-muted" : ""}
                    >
                      {line.label}
                    </Text>
                  </div>
                  {!line.remove && (
                    <div className="grid grid-cols-2 gap-x-3">
                      <div className="flex flex-col gap-y-1">
                        <Label size="xsmall">Quantity</Label>
                        <Input
                          data-testid="inv-change-quantity"
                          type="number"
                          min={1}
                          value={line.quantity}
                          onChange={(e) =>
                            setLine(idx, { quantity: Number(e.target.value) || 0 })
                          }
                        />
                      </div>
                      <div className="flex flex-col gap-y-1">
                        <Label size="xsmall">Unit price</Label>
                        <Input
                          data-testid="inv-change-price"
                          type="number"
                          min={0}
                          value={line.price}
                          onChange={(e) =>
                            setLine(idx, { price: Number(e.target.value) || 0 })
                          }
                        />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-y-2 rounded-lg border border-ui-border-base p-3">
              <Text size="small" weight="plus">
                Tax
              </Text>
              <div className="grid grid-cols-2 gap-x-3">
                <div className="flex flex-col gap-y-1">
                  <Label size="xsmall">Amount</Label>
                  <Input
                    data-testid="inv-change-tax-amount"
                    type="number"
                    min={0}
                    value={taxAmount}
                    onChange={(e) => setTaxAmount(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-y-1">
                  <Label size="xsmall">Note (optional)</Label>
                  <Input
                    data-testid="inv-change-tax-note"
                    value={taxNote}
                    onChange={(e) => setTaxNote(e.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </RouteDrawer.Body>
      <RouteDrawer.Footer>
        <div className="flex items-center gap-x-2">
          <RouteDrawer.Close asChild>
            <Button size="small" variant="secondary">
              Cancel
            </Button>
          </RouteDrawer.Close>
          <Button
            size="small"
            isLoading={isBusy}
            onClick={handleSave}
            disabled={!id || !lines || isBusy}
          >
            Propose changes
          </Button>
        </div>
      </RouteDrawer.Footer>
    </>
  )
}