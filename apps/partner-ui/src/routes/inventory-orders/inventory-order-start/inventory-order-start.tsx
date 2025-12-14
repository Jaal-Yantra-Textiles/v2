import { Button, Heading, Text, toast } from "@medusajs/ui"
import { useParams } from "react-router-dom"

import { RouteDrawer, useRouteModal } from "../../../components/modals"
import { useStartPartnerInventoryOrder } from "../../../hooks/api/partner-inventory-orders"

export const InventoryOrderStart = () => {
  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <RouteDrawer.Title asChild>
          <Heading>Start Inventory Order</Heading>
        </RouteDrawer.Title>
        <RouteDrawer.Description className="sr-only">
          Start the inventory order
        </RouteDrawer.Description>
      </RouteDrawer.Header>
      <InventoryOrderStartContent />
    </RouteDrawer>
  )
}

const InventoryOrderStartContent = () => {
  const { id } = useParams()
  const { handleSuccess } = useRouteModal()

  const { mutateAsync, isPending } = useStartPartnerInventoryOrder(id || "")

  const handleStart = async () => {
    if (!id) {
      return
    }

    await mutateAsync(undefined, {
      onSuccess: () => {
        toast.success("Order started")
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
          This will mark the inventory order as started.
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
            onClick={handleStart}
            disabled={!id}
          >
            Start
          </Button>
        </div>
      </RouteDrawer.Footer>
    </>
  )
}
