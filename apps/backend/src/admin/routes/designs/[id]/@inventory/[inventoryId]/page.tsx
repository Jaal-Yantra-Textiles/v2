import { useEffect, useMemo, useState } from "react"
import {
  Heading,
  Text,
  Skeleton,
  Input,
  Button,
  Textarea,
  Select,
  toast,
} from "@medusajs/ui"
import { RouteDrawer } from "../../../../../components/modal/route-drawer/route-drawer"
import { useDesignInventory, useUpdateInventoryLink } from "../../../../../hooks/api/designs"
import { useParams } from "react-router-dom"
import { useStockLocations } from "../../../../../hooks/api/stock_location"


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
  const { mutateAsync: updateInventoryLink, isPending: isUpdating } = useUpdateInventoryLink(
    id!,
    inventoryId!,
    {
      onSuccess: () => {
        toast.success("Inventory link updated")
      },
      onError: (err) => {
        toast.error(err?.message || "Failed to update inventory link")
      },
    }
  )

  const link = data?.inventory_items.find((item) => item.inventory_item_id === inventoryId)
  const inventory = link?.inventory_item
  const location = link?.location_id
    ? stockLocations.find((loc) => loc.id === link.location_id)
    : undefined

  const initialState = useMemo(
    () => ({
      planned: link?.planned_quantity !== undefined && link?.planned_quantity !== null ? String(link.planned_quantity) : "",
      location: link?.location_id ?? "",
      metadata: link?.metadata ? JSON.stringify(link.metadata, null, 2) : "",
    }),
    [link]
  )

  const [plannedQuantity, setPlannedQuantity] = useState(initialState.planned)
  const [selectedLocation, setSelectedLocation] = useState(initialState.location)
  const [metadataString, setMetadataString] = useState(initialState.metadata)
  const [metadataError, setMetadataError] = useState<string | null>(null)

  useEffect(() => {
    setPlannedQuantity(initialState.planned)
    setSelectedLocation(initialState.location)
    setMetadataString(initialState.metadata)
    setMetadataError(null)
  }, [initialState.planned, initialState.location, initialState.metadata])

  const parsedMetadata = useMemo(() => {
    if (!metadataString.trim()) {
      return null
    }

    try {
      setMetadataError(null)
      return JSON.parse(metadataString)
    } catch (error) {
      setMetadataError("Metadata must be valid JSON")
      return null
    }
  }, [metadataString])

  const hasChanges =
    plannedQuantity !== initialState.planned ||
    selectedLocation !== initialState.location ||
    metadataString !== initialState.metadata

  const handleReset = () => {
    setPlannedQuantity(initialState.planned)
    setSelectedLocation(initialState.location)
    setMetadataString(initialState.metadata)
    setMetadataError(null)
  }

  const handleSave = async () => {
    if (metadataError) {
      return
    }

    const payload = {
      plannedQuantity:
        plannedQuantity.trim() === "" ? null : Number.isNaN(Number(plannedQuantity)) ? null : Number(plannedQuantity),
      locationId: selectedLocation || null,
      metadata: parsedMetadata,
    }

    await updateInventoryLink(payload)
  }

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
          <section className="space-y-4">
            <Heading level="h3" className="text-base">
              Quantities
            </Heading>
            <div className="grid grid-cols-1 gap-4">
              <div className="flex flex-col gap-2">
                <Text size="small" className="text-ui-fg-muted">
                  Planned quantity
                </Text>
                <Input
                  type="number"
                  value={plannedQuantity}
                  min={0}
                  placeholder="Enter planned quantity"
                  onChange={(e) => setPlannedQuantity(e.target.value)}
                />
              </div>
              <div className="rounded-md border border-ui-border-base p-3">
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

          <section className="space-y-3">
            <Heading level="h3" className="text-base">
              Preferred location
            </Heading>
            <Select
              value={selectedLocation || "none"}
              onValueChange={(value) => setSelectedLocation(value === "none" ? "" : value)}
            >
              <Select.Trigger>
                <Select.Value placeholder="Select a stock location" />
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="none">No preference</Select.Item>
                {stockLocations.map((loc) => (
                  <Select.Item key={loc.id} value={loc.id}>
                    {loc.name}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
            {selectedLocation && location && (
              <Text size="small" className="text-ui-fg-muted">
                {location.address && typeof location.address === "string" ? location.address : location.name}
              </Text>
            )}
          </section>

          <section className="space-y-3">
            <Heading level="h3" className="text-base">
              Metadata (JSON)
            </Heading>
            <Textarea
              value={metadataString}
              onChange={(e) => setMetadataString(e.target.value)}
              placeholder='e.g. {"notes": "Cut 1", "priority": "rush"}'
              className="min-h-[150px]"
            />
            {metadataError ? (
              <Text size="small" className="text-ui-fg-error">
                {metadataError}
              </Text>
            ) : (
              <Text size="small" className="text-ui-fg-muted">
                Use valid JSON. Leave empty to clear metadata.
              </Text>
            )}
          </section>
        </div>
      </RouteDrawer.Body>
      <RouteDrawer.Footer>
        <div className="flex w-full items-center justify-between gap-2">
          <RouteDrawer.Close asChild>
            <Button variant="secondary" size="small">
              Close
            </Button>
          </RouteDrawer.Close>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="small" onClick={handleReset} disabled={!hasChanges || isUpdating}>
              Reset
            </Button>
            <Button
              size="small"
              onClick={handleSave}
              disabled={!hasChanges || !!metadataError || isUpdating}
              isLoading={isUpdating}
            >
              Save changes
            </Button>
          </div>
        </div>
      </RouteDrawer.Footer>
    </RouteDrawer>
  )
}

export default InventoryLinkDrawerPage
