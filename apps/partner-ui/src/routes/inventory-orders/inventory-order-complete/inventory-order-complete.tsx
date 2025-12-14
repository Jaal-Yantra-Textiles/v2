import { Button, Heading, Input, Text, toast } from "@medusajs/ui"
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

  const initialLines = useMemo<LineDraft[]>(() => {
    return orderLines.map((l) => ({
      order_line_id: String(l.id),
      quantity: Number(l.quantity ?? 0),
    }))
  }, [orderLines])

  const [lines, setLines] = useState<LineDraft[]>([])
  const [notes, setNotes] = useState<string>("")
  const [deliveryDate, setDeliveryDate] = useState<string>("")
  const [trackingNumber, setTrackingNumber] = useState<string>("")

  useEffect(() => {
    if (initialLines.length) {
      setLines(initialLines)
    }
  }, [initialLines])

  if (isError) {
    throw error
  }

  const handleComplete = async () => {
    if (!lines.length) {
      toast.error("No order lines")
      return
    }

    await completeOrder(
      {
        notes: notes || undefined,
        deliveryDate: deliveryDate || undefined,
        trackingNumber: trackingNumber || undefined,
        lines: lines.map((l) => ({
          order_line_id: l.order_line_id,
          quantity: l.quantity,
        })),
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
              <Input
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
                placeholder="YYYY-MM-DD"
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
            <Heading level="h2">Lines</Heading>
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
                        <Input
                          type="number"
                          min={0}
                          value={current?.quantity ?? 0}
                          onChange={(e) => {
                            const qty = Number(e.target.value || 0)
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
          <Button size="small" isLoading={isCompleting} onClick={handleComplete}>
            Complete
          </Button>
        </div>
      </RouteFocusModal.Footer>
    </>
  )
}
