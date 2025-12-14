import { Button, Heading, Input, Text, toast } from "@medusajs/ui"
import { useEffect, useMemo, useState } from "react"
import { useParams } from "react-router-dom"

import { RouteFocusModal, useRouteModal } from "../../../components/modals"
import {
  useCompletePartnerDesign,
  usePartnerDesign,
} from "../../../hooks/api/partner-designs"

type ConsumptionDraft = {
  inventory_item_id: string
  quantity: number
  location_id?: string
}

export const DesignComplete = () => {
  const { id } = useParams()

  return (
    <RouteFocusModal>
      <RouteFocusModal.Header>
        <RouteFocusModal.Title asChild>
          <Heading>Complete Design</Heading>
        </RouteFocusModal.Title>
        <RouteFocusModal.Description className="sr-only">
          Complete the design and submit consumptions
        </RouteFocusModal.Description>
      </RouteFocusModal.Header>
      {id ? <DesignCompleteWithId id={id} /> : <DesignCompleteMissingId />}
    </RouteFocusModal>
  )
}

const DesignCompleteMissingId = () => {
  return (
    <>
      <RouteFocusModal.Body className="overflow-auto">
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">
            Missing design id.
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

const DesignCompleteWithId = ({ id }: { id: string }) => {
  const { handleSuccess } = useRouteModal()

  const { design, isPending, isError, error } = usePartnerDesign(id)
  const { mutateAsync: completeDesign, isPending: isCompleting } =
    useCompletePartnerDesign(id)

  const inventoryItems = (design?.inventory_items || []) as Array<Record<string, any>>

  const initialConsumptions = useMemo(() => {
    return inventoryItems.map((it) => ({
      inventory_item_id: String(it.id),
      quantity: 0,
      location_id: it?.location_levels?.[0]?.stock_location?.id,
    }))
  }, [inventoryItems])

  const [consumptions, setConsumptions] = useState<ConsumptionDraft[]>([])

  useEffect(() => {
    if (initialConsumptions.length) {
      setConsumptions(initialConsumptions)
    }
  }, [initialConsumptions])

  if (isError) {
    throw error
  }

  const handleComplete = async () => {
    const payload = {
      consumptions: consumptions
        .filter((c) => c.quantity > 0)
        .map((c) => ({
          inventory_item_id: c.inventory_item_id,
          quantity: c.quantity,
          location_id: c.location_id,
        })),
    }

    if (!payload.consumptions.length) {
      toast.error("Add at least one consumption quantity")
      return
    }

    await completeDesign(payload, {
      onSuccess: () => {
        toast.success("Design completed")
        handleSuccess()
      },
      onError: (e) => {
        toast.error(e.message)
      },
    })
  }

  return (
    <>
      <RouteFocusModal.Body className="overflow-auto">
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">
            Enter quantities for inventory items consumed while completing the design.
          </Text>

          <div className="mt-4 flex flex-col gap-y-3">
            {isPending ? (
              <Text size="small" className="text-ui-fg-subtle">
                Loading...
              </Text>
            ) : inventoryItems.length === 0 ? (
              <Text size="small" className="text-ui-fg-subtle">
                No inventory items linked to this design.
              </Text>
            ) : (
              inventoryItems.map((item, idx) => {
                const current = consumptions[idx]
                const label = item?.title || item?.name || item?.sku || item?.id

                return (
                  <div
                    key={String(item.id)}
                    className="grid grid-cols-1 gap-3 rounded-lg border p-4 md:grid-cols-[1fr_200px]"
                  >
                    <div className="min-w-0">
                      <Text size="small" weight="plus" className="truncate">
                        {String(label)}
                      </Text>
                      <Text size="xsmall" className="text-ui-fg-subtle">
                        {String(item.id)}
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
                          setConsumptions((prev) => {
                            const next = [...prev]
                            next[idx] = {
                              ...(next[idx] || {
                                inventory_item_id: String(item.id),
                                quantity: 0,
                              }),
                              inventory_item_id: String(item.id),
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
            onClick={handleComplete}
          >
            Complete
          </Button>
        </div>
      </RouteFocusModal.Footer>
    </>
  )
}
