import { Heading, Text, Skeleton } from "@medusajs/ui"
import { RouteDrawer } from "../../../../../components/modal/route-drawer/route-drawer"
import { useDesignInventory } from "../../../../../hooks/api/designs"
import { useParams } from "react-router-dom"
import { useStockLocations } from "../../../../../hooks/api/stock_location"

const formatMetadata = (metadata?: Record<string, any>) => {
  if (!metadata || !Object.keys(metadata).length) {
    return "—"
  }

  try {
    return JSON.stringify(metadata, null, 2)
  } catch {
    return "Invalid metadata"
  }
}

const formatConsumedAt = (consumedAt?: string) => {
  if (!consumedAt) {
    return "Not recorded"
  }

  const date = new Date(consumedAt)
  if (Number.isNaN(date.getTime())) {
    return consumedAt
  }

  return date.toLocaleString()
}

const InventoryLinkDrawerPage = () => {
  const { id, inventoryId } = useParams()
  const { data, isLoading } = useDesignInventory(id!)
  const { stock_locations: stockLocations = [] } = useStockLocations({ limit: 100 })

  const link = data?.inventory_items.find((item) => item.inventory_item_id === inventoryId)
  const inventory = link?.inventory_item
  const location = link?.location_id
    ? stockLocations.find((loc) => loc.id === link.location_id)
    : undefined

  if (isLoading) {
    return (
      <RouteDrawer>
        <RouteDrawer.Header>
          <Heading>Inventory Details</Heading>
        </RouteDrawer.Header>
        <RouteDrawer.Body>
          <Skeleton className="h-6 w-1/2 mb-4" />
          <Skeleton className="h-4 w-full" />
        </RouteDrawer.Body>
      </RouteDrawer>
    )
  }

  if (!link) {
    return (
      <RouteDrawer>
        <RouteDrawer.Header>
          <Heading>Inventory Details</Heading>
        </RouteDrawer.Header>
        <RouteDrawer.Body>
          <Text className="text-ui-fg-subtle">Inventory link not found.</Text>
        </RouteDrawer.Body>
      </RouteDrawer>
    )
  }

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <div className="space-y-1">
          <Heading>{inventory?.title || link.inventory_item_id}</Heading>
          {inventory?.sku && (
            <Text size="small" className="text-ui-fg-subtle">
              {inventory.sku}
            </Text>
          )}
          {link.inventory_item_id && (
            <Text size="small" className="text-ui-fg-muted">
              #{link.inventory_item_id}
            </Text>
          )}
        </div>
      </RouteDrawer.Header>
      <RouteDrawer.Body>
        <div className="space-y-6">
          <section>
            <Heading level="h3" className="text-base mb-1">
              Quantities
            </Heading>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Text size="small" className="text-ui-fg-muted">
                  Planned Quantity
                </Text>
                <Text weight="plus" className="text-lg">
                  {link.planned_quantity ?? "—"}
                </Text>
              </div>
              <div>
                <Text size="small" className="text-ui-fg-muted">
                  Consumed
                </Text>
                <Text weight="plus" className="text-lg">
                  {link.consumed_quantity ?? 0}
                </Text>
                <Text size="xsmall" className="text-ui-fg-subtle">
                  {formatConsumedAt(link.consumed_at)}
                </Text>
              </div>
            </div>
          </section>

          <section>
            <Heading level="h3" className="text-base mb-1">
              Location
            </Heading>
            <Text weight="plus">
              {location?.name || link.location_id || "—"}
            </Text>
            {location?.address &&
              typeof location.address === "string" && (
                <Text size="small" className="text-ui-fg-subtle">
                  {location.address}
                </Text>
              )}
          </section>

          <section>
            <Heading level="h3" className="text-base mb-1">
              Metadata
            </Heading>
            <pre className="text-xs bg-ui-bg-field rounded-md p-3 overflow-x-auto">
              {formatMetadata(link.metadata)}
            </pre>
          </section>
        </div>
      </RouteDrawer.Body>
    </RouteDrawer>
  )
}

export default InventoryLinkDrawerPage
