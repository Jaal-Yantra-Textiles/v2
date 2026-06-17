import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { DetailWidgetProps } from "@medusajs/framework/types"
import { Badge, Button, Container, Heading, Skeleton, Text, toast } from "@medusajs/ui"
import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { sdk } from "../lib/config"

/**
 * Shiprocket pickup-location registration (#31, SHIPPING_PROVIDERS.md §9).
 *
 * Outbound opt-in surface for the on-demand admin route
 * `/admin/stock-locations/:id/shiprocket-pickup` (GET status, POST register).
 *
 * Per §9.3 the status/action is "default-hidden — surfaced on demand": the
 * widget shows only a title + a "Check status" action until the operator asks,
 * which also avoids a live Shiprocket list call on every stock-location view.
 */

type StockLocation = { id: string; name?: string }

type PickupStatus = {
  name: string
  already_existed: boolean
  shippable?: boolean
  phone_verified?: boolean
} | null

const ShiprocketPickupWidget = ({ data }: DetailWidgetProps<StockLocation>) => {
  const [revealed, setRevealed] = useState(false)
  const queryClient = useQueryClient()
  const queryKey = ["shiprocket-pickup", data.id]

  const { data: res, isFetching, isError, error } = useQuery({
    queryKey,
    queryFn: () =>
      sdk.client.fetch<{ pickup: PickupStatus }>(
        `/admin/stock-locations/${data.id}/shiprocket-pickup`
      ),
    enabled: revealed,
  })

  const register = useMutation({
    mutationFn: () =>
      sdk.client.fetch<{ pickup: PickupStatus }>(
        `/admin/stock-locations/${data.id}/shiprocket-pickup`,
        { method: "POST" }
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data)
      setRevealed(true)
      toast.success(
        data.pickup?.already_existed
          ? "Pickup already registered with Shiprocket"
          : "Registered pickup with Shiprocket"
      )
    },
    onError: (e: any) =>
      toast.error(e?.message || "Failed to register Shiprocket pickup"),
  })

  const status = res?.pickup ?? null

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Shiprocket Pickup</Heading>
          <Text size="small" leading="compact" className="text-ui-fg-subtle mt-1">
            Register this location as a pickup point in our Shiprocket account.
          </Text>
        </div>
        {!revealed ? (
          <Button
            size="small"
            variant="secondary"
            onClick={() => setRevealed(true)}
          >
            Check status
          </Button>
        ) : (
          <Button
            size="small"
            variant={status ? "secondary" : "primary"}
            onClick={() => register.mutate()}
            isLoading={register.isPending}
            disabled={register.isPending || isFetching}
          >
            {status ? "Re-register" : "Register pickup"}
          </Button>
        )}
      </div>

      {revealed && (
        <div className="px-6 py-4">
          {isFetching ? (
            <Skeleton className="h-6 w-64" />
          ) : isError ? (
            <Text size="small" leading="compact" className="text-ui-fg-error">
              {(error as any)?.message || "Couldn't load Shiprocket pickup status"}
            </Text>
          ) : status ? (
            <div className="flex flex-col gap-y-1">
              <div className="flex items-center gap-x-3">
                <Text size="small" leading="compact" weight="plus">
                  {status.name}
                </Text>
                {status.shippable === true ? (
                  <Badge size="2xsmall" color="green">
                    Ready to ship
                  </Badge>
                ) : status.shippable === false ? (
                  <Badge size="2xsmall" color="orange">
                    Address incomplete
                  </Badge>
                ) : (
                  <Badge size="2xsmall" color="grey">
                    Registered
                  </Badge>
                )}
              </div>
              {status.shippable === true && status.phone_verified === false ? (
                <Text
                  size="xsmall"
                  leading="compact"
                  className="text-ui-fg-subtle"
                >
                  Phone OTP not completed — not required for API-registered
                  pickups.
                </Text>
              ) : status.shippable === false ? (
                <Text
                  size="xsmall"
                  leading="compact"
                  className="text-ui-fg-subtle"
                >
                  Add a full address (street, city, pincode, phone) in Shiprocket
                  to enable live pickups.
                </Text>
              ) : null}
            </div>
          ) : (
            <Text size="small" leading="compact" className="text-ui-fg-subtle">
              Not registered with Shiprocket. Click “Register pickup” to add this
              location to our Shiprocket pickup set.
            </Text>
          )}
        </div>
      )}
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "location.details.after",
})

export default ShiprocketPickupWidget
