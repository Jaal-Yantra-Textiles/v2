import { Button, DatePicker, Heading, Input, Text, toast } from "@medusajs/ui"
import { useEffect, useMemo, useState } from "react"
import { useParams } from "react-router-dom"

import { RouteFocusModal, useRouteModal } from "../../../components/modals"
import {
  useCompletePartnerInventoryOrder,
  usePartnerInventoryOrder,
} from "../../../hooks/api/partner-inventory-orders"

type LineDraft = { order_line_id: string; quantity: number }

export const InventoryOrderComplete = () => {
  const { id } = useParams()

  return (
    <RouteFocusModal>
      <RouteFocusModal.Header>
        <RouteFocusModal.Title asChild>
          <Heading>Complete Inventory Order</Heading>
        </RouteFocusModal.Title>
        <RouteFocusModal.Description className="sr-only">
          Complete the inventory order
        </RouteFocusModal.Description>
      </RouteFocusModal.Header>
      {id ? <InventoryOrderCompleteWithId id={id} /> : <MissingId />}
    </RouteFocusModal>
  )
}

const MissingId = () => {
  return (
    <>
      <RouteFocusModal.Body className="overflow-auto">
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">
            Missing inventory order id.
          </Text>
        </div>
      </RouteFocusModal.Body>
      <RouteFocusModal.Footer>
        <div className="flex items-center justify-end gap-x-2">
          <RouteFocusModal.Close asChild>
            <Button size="small" variant="secondary">
              Cancel
            </Button>
          </RouteFocusModal.Close>
        </div>
      </RouteFocusModal.Footer>
    </>
  )
}

const InventoryOrderCompleteWithId = ({ id }: { id: string }) => {
  const { handleSuccess } = useRouteModal()

  const { inventoryOrder, isPending, isError, error } = usePartnerInventoryOrder(id)
  const { mutateAsync: completeOrder, isPending: isCompleting } =
    useCompletePartnerInventoryOrder(id)

  const orderLines = (inventoryOrder?.order_lines || []) as Array<Record<string, any>>

  const remainingByLineId = useMemo(() => {
    const map = new Map<string, number>()

    for (const l of orderLines) {
      const id = String(l?.id)
      const requested = Number(l?.quantity) || 0
      const fulfilled = Array.isArray(l?.line_fulfillments)
        ? l.line_fulfillments.reduce(
            (sum: number, f: any) => sum + (Number(f?.quantity_delta) || 0),
            0
          )
        : 0

      map.set(id, Math.max(0, requested - fulfilled))
    }

    return map
  }, [orderLines])

  const initialLines = useMemo<LineDraft[]>(() => {
    return orderLines.map((l) => ({
      order_line_id: String(l.id),
      quantity: 0,
    }))
  }, [orderLines])

  const [lines, setLines] = useState<LineDraft[]>([])
  const [notes, setNotes] = useState<string>("")
  const [deliveryDate, setDeliveryDate] = useState<Date | null>(null)
  const [trackingNumber, setTrackingNumber] = useState<string>("")

  const formatDate = (date: Date) => {
    const yyyy = date.getFullYear()
    const mm = String(date.getMonth() + 1).padStart(2, "0")
    const dd = String(date.getDate()).padStart(2, "0")
    return `${yyyy}-${mm}-${dd}`
  }

  useEffect(() => {
    if (initialLines.length) {
      setLines(initialLines)
    }
  }, [initialLines])

  const overDeliveredLines = useMemo(() => {
    return (lines || []).filter((l) => {
      const remaining = remainingByLineId.get(String(l.order_line_id)) ?? 0
      return Number(l.quantity || 0) > remaining
    })
  }, [lines, remainingByLineId])

  const hasOverDelivery = overDeliveredLines.length > 0

  const isFullDelivery = useMemo(() => {
    if (!lines.length) {
      return false
    }
    return lines.every((l) => {
      const remaining = remainingByLineId.get(String(l.order_line_id)) ?? 0
      return Number(l.quantity || 0) === remaining
    })
  }, [lines, remainingByLineId])

  const handleFillAll = () => {
    setLines(
      orderLines.map((l) => ({
        order_line_id: String(l.id),
        quantity: remainingByLineId.get(String(l.id)) ?? 0,
      }))
    )
  }

  if (isError) {
    throw error
  }

  const handleComplete = async () => {
    if (!lines.length) {
      toast.error("No order lines")
      return
    }

    if (hasOverDelivery) {
      toast.error(
        `Invalid quantities: ${overDeliveredLines.length} line(s) exceed the remaining quantity.`
      )
      return
    }

    if (!isFullDelivery && !notes.trim()) {
      toast.error("Add notes when completing with partial delivery.")
      return
    }

    const trimmedLines = lines
      .map((l) => ({
        order_line_id: l.order_line_id,
        quantity: Number(l.quantity || 0),
      }))
      .filter((l) => Number.isFinite(l.quantity) && l.quantity > 0)

    if (!trimmedLines.length) {
      toast.error("Please provide at least one line with quantity greater than 0.")
      return
    }

    await completeOrder(
      {
        notes: notes || undefined,
        deliveryDate: deliveryDate ? formatDate(deliveryDate) : undefined,
        trackingNumber: trackingNumber || undefined,
        lines: trimmedLines,
      },
      {
        onSuccess: () => {
          toast.success("Order completed")
          handleSuccess()
        },
        onError: (e) => {
          toast.error(e.message)
        },
      }
    )
  }

  return (
    <>
      <RouteFocusModal.Body className="overflow-auto">
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">
            Provide completion details and confirm quantities.
          </Text>

          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <Text size="xsmall" className="text-ui-fg-subtle">
                Notes
              </Text>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div>
              <Text size="xsmall" className="text-ui-fg-subtle">
                Delivery date
              </Text>
              <DatePicker
                granularity="day"
                value={deliveryDate}
                onChange={setDeliveryDate}
              />
            </div>
            <div>
              <Text size="xsmall" className="text-ui-fg-subtle">
                Tracking number
              </Text>
              <Input
                value={trackingNumber}
                onChange={(e) => setTrackingNumber(e.target.value)}
              />
            </div>
          </div>

          <div className="mt-6">
            <div className="flex items-center justify-between">
              <Heading level="h2">Lines</Heading>
              <Button size="small" variant="secondary" onClick={handleFillAll}>
                Fill All Remaining
              </Button>
            </div>
            {!isFullDelivery && (
              <Text size="small" className="text-ui-fg-subtle">
                Partial delivery detected. Add notes or set quantities to match remaining.
              </Text>
            )}
            <div className="mt-4 flex flex-col gap-y-3">
              {isPending ? (
                <Text size="small" className="text-ui-fg-subtle">
                  Loading...
                </Text>
              ) : !orderLines.length ? (
                <Text size="small" className="text-ui-fg-subtle">
                  No lines
                </Text>
              ) : (
                orderLines.map((line, idx) => {
                  const current = lines[idx]
                  const title =
                    line?.inventory_items?.[0]?.title ||
                    line?.inventory_items?.[0]?.name ||
                    line?.inventory_item_id ||
                    line?.id

                  const remaining = remainingByLineId.get(String(line.id)) ?? 0

                  return (
                    <div
                      key={String(line.id)}
                      className="grid grid-cols-1 gap-3 rounded-lg border p-4 md:grid-cols-[1fr_220px]"
                    >
                      <div className="min-w-0">
                        <Text size="small" weight="plus" className="truncate">
                          {String(title)}
                        </Text>
                        <Text size="xsmall" className="text-ui-fg-subtle">
                          Line: {String(line.id)}
                        </Text>
                      </div>
                      <div>
                        <Text size="xsmall" className="text-ui-fg-subtle">
                          Quantity
                        </Text>
                        <Text size="xsmall" className="text-ui-fg-subtle">
                          Remaining: {String(remaining)}
                        </Text>
                        <Input
                          type="number"
                          min={0}
                          step="any"
                          max={remaining}
                          placeholder={`Max: ${remaining}`}
                          value={current?.quantity ?? 0}
                          onChange={(e) => {
                            const raw = Number(e.target.value || 0)
                            const qty = Math.max(0, Math.min(raw, remaining))
                            setLines((prev) => {
                              const next = [...prev]
                              next[idx] = {
                                order_line_id: String(line.id),
                                quantity: qty,
                              }
                              return next
                            })
                          }}
                        />
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      </RouteFocusModal.Body>

      <RouteFocusModal.Footer>
        <div className="flex items-center justify-end gap-x-2">
          <RouteFocusModal.Close asChild>
            <Button size="small" variant="secondary">
              Cancel
            </Button>
          </RouteFocusModal.Close>
          <Button
            size="small"
            isLoading={isCompleting}
            disabled={hasOverDelivery}
            onClick={handleComplete}
          >
            Complete
          </Button>
        </div>
      </RouteFocusModal.Footer>
    </>
  )
}
