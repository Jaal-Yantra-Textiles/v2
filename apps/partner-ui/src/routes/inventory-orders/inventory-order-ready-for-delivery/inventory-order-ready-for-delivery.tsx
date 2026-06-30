import { Button, Heading, Text, toast } from "@medusajs/ui"
import { useQueryClient } from "@tanstack/react-query"

import { RouteDrawer, useRouteModal } from "../../../components/modals"
import { ordersQueryKeys } from "../../../hooks/api/orders"
import { useMarkPartnerInventoryOrderReadyForDelivery } from "../../../hooks/api/partner-inventory-orders"
import { useInventoryActionTarget } from "../../../hooks/use-inventory-action-target"

export const InventoryOrderReadyForDelivery = () => {
  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <RouteDrawer.Title asChild>
          <Heading>Mark Ready for Delivery</Heading>
        </RouteDrawer.Title>
        <RouteDrawer.Description className="sr-only">
          Mark the inventory order ready for delivery
        </RouteDrawer.Description>
      </RouteDrawer.Header>
      <InventoryOrderReadyForDeliveryContent />
    </RouteDrawer>
  )
}

const InventoryOrderReadyForDeliveryContent = () => {
  const { inventoryOrderId: id, unifiedOrderId } = useInventoryActionTarget()
  const { handleSuccess } = useRouteModal()
  const queryClient = useQueryClient()

  const { mutateAsync, isPending } =
    useMarkPartnerInventoryOrderReadyForDelivery(id || "")

  const handleConfirm = async () => {
    if (!id) {
      return
    }

    await mutateAsync(undefined, {
      onSuccess: () => {
        toast.success("Marked ready for delivery")
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
    })
  }

  return (
    <>
      <RouteDrawer.Body>
        <Text size="small" className="text-ui-fg-subtle">
          This marks the order as packed and ready to hand to the carrier.
          You can create the shipment next.
        </Text>
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
            Mark Ready for Delivery
          </Button>
        </div>
      </RouteDrawer.Footer>
    </>
  )
}
