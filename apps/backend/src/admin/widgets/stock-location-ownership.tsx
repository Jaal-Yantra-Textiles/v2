import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { DetailWidgetProps } from "@medusajs/framework/types"
import { Badge, Container, Heading, Skeleton, Switch, Text, toast } from "@medusajs/ui"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { sdk } from "../lib/config"

/**
 * Is this location ours?
 *
 * Consumption is only ever deducted from a location we own, so this switch
 * decides whether material burned against a design moves stock here at all.
 * It used to be inferred — the brand store was whichever store no partner
 * linked to, and its default location was the only one that counted — which
 * could not express stocking at several of our own warehouses and broke
 * outright on a store with no partner link.
 *
 * A location with nothing recorded reads as NOT ours. That is deliberate:
 * treating an unknown location as ours would deduct partner-held stock, which
 * is the one thing the boundary exists to prevent.
 */

type StockLocation = { id: string; name?: string }

type OwnershipRow = {
  id: string
  stock_location_id: string
  is_core: boolean
  note?: string | null
}

const QUERY_KEY = ["location-ownership"]

const LocationOwnershipWidget = ({
  data,
}: DetailWidgetProps<StockLocation>) => {
  const locationId = data?.id
  const queryClient = useQueryClient()

  const { data: ownership, isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () =>
      (await sdk.client.fetch("/admin/location-ownership")) as {
        location_ownership: OwnershipRow[]
      },
  })

  const row = ownership?.location_ownership?.find(
    (r) => r.stock_location_id === locationId
  )
  const isCore = Boolean(row?.is_core)

  const { mutate, isPending } = useMutation({
    mutationFn: async (next: boolean) =>
      sdk.client.fetch("/admin/location-ownership", {
        method: "POST",
        // No JSON.stringify — the SDK client serialises the body itself.
        body: {
          stock_location_id: locationId,
          is_core: next,
          note: next ? "marked ours from the location page" : "marked not ours",
        },
      }),
    onSuccess: (_res, next) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY })
      toast.success(
        next
          ? "Marked as ours — consumption can be deducted here"
          : "Marked as not ours — consumption will never deduct here"
      )
    },
    onError: (error: any) => {
      toast.error(error?.message || "Failed to update location ownership")
    },
  })

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Stock ownership</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Whether we own the stock held here
          </Text>
        </div>
        {isLoading ? (
          <Skeleton className="h-6 w-16" />
        ) : (
          <Badge color={isCore ? "green" : "grey"}>
            {isCore ? "Ours" : "Not ours"}
          </Badge>
        )}
      </div>

      <div className="flex items-center justify-between gap-x-4 px-6 py-4">
        <Text size="small" className="text-ui-fg-subtle">
          {isCore
            ? "Material consumed against a design can be deducted from this location."
            : "Consumption is never deducted from this location. Leave this off for partner warehouses — their stock is not on our books."}
        </Text>
        {isLoading ? (
          <Skeleton className="h-6 w-10" />
        ) : (
          <Switch
            checked={isCore}
            disabled={isPending || !locationId}
            onCheckedChange={(next) => mutate(next)}
          />
        )}
      </div>

      {!isLoading && !row && (
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-muted">
            Nothing recorded for this location yet, so it counts as not ours.
          </Text>
        </div>
      )}
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "location.details.after",
})

export default LocationOwnershipWidget
