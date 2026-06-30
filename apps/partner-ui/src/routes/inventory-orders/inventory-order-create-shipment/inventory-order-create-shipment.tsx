import { useState } from "react"
import { Button, Heading, Input, Label, Text, toast } from "@medusajs/ui"
import { useQueryClient } from "@tanstack/react-query"

import { RouteDrawer, useRouteModal } from "../../../components/modals"
import { ordersQueryKeys } from "../../../hooks/api/orders"
import { useCreatePartnerInventoryOrderShipment } from "../../../hooks/api/partner-inventory-orders"
import { useInventoryActionTarget } from "../../../hooks/use-inventory-action-target"

export const InventoryOrderCreateShipment = () => {
  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <RouteDrawer.Title asChild>
          <Heading>Create shipment</Heading>
        </RouteDrawer.Title>
        <RouteDrawer.Description className="sr-only">
          Generate a carrier shipment for this inventory order
        </RouteDrawer.Description>
      </RouteDrawer.Header>
      <InventoryOrderCreateShipmentContent />
    </RouteDrawer>
  )
}

const InventoryOrderCreateShipmentContent = () => {
  const { inventoryOrderId: id, unifiedOrderId } = useInventoryActionTarget()
  const { handleSuccess } = useRouteModal()
  const queryClient = useQueryClient()
  const [weight, setWeight] = useState("")

  const { mutateAsync, isPending } =
    useCreatePartnerInventoryOrderShipment(id || "")

  const handleConfirm = async () => {
    if (!id) {
      return
    }

    await mutateAsync(
      { ...(weight ? { weight_grams: Number(weight) } : {}) },
      {
        onSuccess: (data) => {
          const awb = data?.shipment?.awb || data?.shipment?.tracking_number
          toast.success(awb ? `Shipment created — AWB ${awb}` : "Shipment created")
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

  return (
    <>
      <RouteDrawer.Body className="flex flex-col gap-y-4">
        <Text size="small" className="text-ui-fg-subtle">
          Generate a carrier shipment (AWB + label) for this order using the
          registered pickup. Weight is optional — leave it blank to use the
          order's default.
        </Text>
        <div className="flex flex-col gap-y-1">
          <Label size="small" htmlFor="weight">
            Weight (grams)
          </Label>
          <Input
            id="weight"
            type="number"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            placeholder="500"
          />
        </div>
        {!id && (
          <Text size="small" className="text-ui-fg-subtle">
            Missing inventory order id.
          </Text>
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
            isLoading={isPending}
            onClick={handleConfirm}
            disabled={!id}
          >
            Create shipment
          </Button>
        </div>
      </RouteDrawer.Footer>
    </>
  )
}
