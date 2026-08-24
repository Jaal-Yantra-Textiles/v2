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
  /** #1498 — null means "nobody has decided", which is not the same as false. */
  is_export_origin?: boolean | null
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
  const exportState = row?.is_export_origin
  const isExportOrigin = exportState === true
  /**
   * Nobody on the platform has stated an export answer yet, so the relay is
   * still inferring hubs from `is_core`. Worth saying out loud on this page: it
   * is why a location that holds stock but cannot export is currently offered
   * as an export origin.
   */
  const inferring = !(ownership?.location_ownership ?? []).some(
    (r) => r.is_export_origin === true || r.is_export_origin === false
  )

  const { mutate, isPending } = useMutation({
    mutationFn: async (next: boolean) =>
      sdk.client.fetch("/admin/location-ownership", {
        method: "POST",
        // No JSON.stringify — the SDK client serialises the body itself.
        body: {
          stock_location_id: locationId,
          is_core: next,
          // 🔑 `is_export_origin` is deliberately NOT sent. Omitted means
          // "leave the stored answer alone" — sending `false` here would make
          // an unrelated stock edit silently switch the whole platform off the
          // inference (see the validator).
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

  const exportMutation = useMutation({
    mutationFn: async (next: boolean) =>
      sdk.client.fetch("/admin/location-ownership", {
        method: "POST",
        body: {
          stock_location_id: locationId,
          // The route upserts the whole row, so the stock answer has to travel
          // with it or the toggle would silently un-mark an owned location.
          is_core: isCore,
          is_export_origin: next,
        },
      }),
    onSuccess: (_res, next) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY })
      toast.success(
        next
          ? "Exports may leave from here"
          : "Exports will never be routed through here"
      )
    },
    onError: (error: any) => {
      toast.error(error?.message || "Failed to update the export setting")
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

      {/* #1498 — a SECOND question, not the same one.
          "We own the stock here" and "an export may leave from here" were one
          flag, and the freight relay read the first as the second. Prod's two
          owned locations include Dharamshala, which is not a hub — so a
          shipment was relayed somewhere it cannot be exported from, priced as
          though it had worked. */}
      <div className="flex items-center justify-between gap-x-4 px-6 py-4">
        <div>
          <div className="flex items-center gap-x-2">
            <Text size="small" weight="plus">
              Export origin
            </Text>
            {isLoading ? null : (
              <Badge color={isExportOrigin ? "green" : "grey"}>
                {exportState === true
                  ? "Exports from here"
                  : exportState === false
                    ? "Never"
                    : "Not decided"}
              </Badge>
            )}
          </div>
          <Text size="small" className="text-ui-fg-subtle">
            {isExportOrigin
              ? "International quotes a partner's own pin cannot be rated for will be routed through here."
              : "International shipments are never routed through this location."}
          </Text>
          {inferring && !isLoading ? (
            <Text size="small" className="text-ui-fg-muted">
              Nobody has answered this for any location yet, so exports are
              still being routed through every location marked “ours” — which
              includes warehouses that hold stock but cannot export. Answering
              it here, for any one location, switches that guess off everywhere.
            </Text>
          ) : null}
        </div>
        {isLoading ? (
          <Skeleton className="h-6 w-10" />
        ) : (
          <Switch
            checked={isExportOrigin}
            disabled={exportMutation.isPending || !locationId}
            onCheckedChange={(next) => exportMutation.mutate(next)}
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
