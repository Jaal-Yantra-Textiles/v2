import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { DetailWidgetProps } from "@medusajs/framework/types"
import { Badge, Button, Container, Heading, Skeleton, Text, toast } from "@medusajs/ui"
import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { sdk } from "../lib/config"

/**
 * Carrier pickup registration for a stock location — Shiprocket AND Delhivery.
 *
 * Replaces the Shiprocket-only widget. A location has to be a registered pickup
 * before a carrier accepts a shipment from it, and until now that was only
 * visible for one of the two carriers: Delhivery had no surface at all, which is
 * why every location was unregistered and every Delhivery fulfillment failed
 * with "ClientWarehouse matching query does not exist." (order #83).
 *
 * "Where can I ship this location's goods from?" is one question, so it gets one
 * card listing every carrier rather than a stack of per-carrier widgets.
 *
 * Kept default-hidden (SHIPPING_PROVIDERS.md §9.3): status is fetched only when
 * the operator asks, which also avoids a live carrier call on every page view.
 */

type StockLocation = { id: string; name?: string }

type CarrierPickup = {
  carrier: "shiprocket" | "delhivery"
  registered: boolean
  status: {
    name: string
    already_existed: boolean
    shippable?: boolean
    phone_verified?: boolean
  } | null
  error?: string
}

const CARRIER_LABELS: Record<CarrierPickup["carrier"], string> = {
  shiprocket: "Shiprocket",
  delhivery: "Delhivery",
}

const CarrierRow = ({
  pickup,
  onRegister,
  isRegistering,
  disabled,
}: {
  pickup: CarrierPickup
  onRegister: () => void
  isRegistering: boolean
  disabled: boolean
}) => {
  const { status } = pickup

  return (
    <div className="flex items-start justify-between gap-x-4 py-3">
      <div className="flex flex-col gap-y-1">
        <div className="flex items-center gap-x-3">
          <Text size="small" leading="compact" weight="plus">
            {CARRIER_LABELS[pickup.carrier]}
          </Text>
          {pickup.error ? (
            <Badge size="2xsmall" color="red">
              Unavailable
            </Badge>
          ) : !status ? (
            <Badge size="2xsmall" color="grey">
              Not registered
            </Badge>
          ) : status.shippable === true ? (
            <Badge size="2xsmall" color="green">
              Ready to ship
            </Badge>
          ) : status.shippable === false ? (
            <Badge size="2xsmall" color="orange">
              Address incomplete
            </Badge>
          ) : (
            <Badge size="2xsmall" color="green">
              Registered
            </Badge>
          )}
        </div>

        {pickup.error ? (
          <Text size="xsmall" leading="compact" className="text-ui-fg-error">
            {pickup.error}
          </Text>
        ) : status ? (
          <>
            <Text size="xsmall" leading="compact" className="text-ui-fg-subtle">
              {status.name}
            </Text>
            {status.shippable === false ? (
              <Text size="xsmall" leading="compact" className="text-ui-fg-subtle">
                Add a full address (street, city, pincode, phone) to enable live
                pickups. A Google Maps Plus Code works as address line 1 when the
                street has no house or road number.
              </Text>
            ) : status.phone_verified === false ? (
              // The OTP is sent to the pickup phone and completed on the
              // carrier's side — we can report it, never perform it. Registered
              // pickups still accept shipments; this gates live pickup requests.
              <Text size="xsmall" leading="compact" className="text-ui-fg-subtle">
                Phone not OTP-verified yet — verify it from the carrier dashboard
                on the number registered for this location to enable live pickups.
              </Text>
            ) : null}
          </>
        ) : (
          <Text size="xsmall" leading="compact" className="text-ui-fg-subtle">
            Shipments from this location will be refused until it is registered.
          </Text>
        )}
      </div>

      <Button
        size="small"
        variant={status ? "secondary" : "primary"}
        onClick={onRegister}
        isLoading={isRegistering}
        disabled={disabled}
      >
        {status ? "Re-register" : "Register"}
      </Button>
    </div>
  )
}

const CarrierPickupsWidget = ({ data }: DetailWidgetProps<StockLocation>) => {
  const [revealed, setRevealed] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const queryKey = ["carrier-pickups", data.id]

  const { data: res, isFetching, isError, error } = useQuery({
    queryKey,
    queryFn: () =>
      sdk.client.fetch<{ pickups: CarrierPickup[] }>(
        `/admin/stock-locations/${data.id}/carrier-pickups`
      ),
    enabled: revealed,
  })

  const register = useMutation({
    mutationFn: (carrier?: CarrierPickup["carrier"]) =>
      sdk.client.fetch<{ pickups: CarrierPickup[] }>(
        `/admin/stock-locations/${data.id}/carrier-pickups`,
        { method: "POST", body: carrier ? { carrier } : {} }
      ),
    onSuccess: (result) => {
      setRevealed(true)
      // A single-carrier register returns only that carrier — merge it into the
      // cached list so the other carrier's status doesn't vanish from the card.
      queryClient.setQueryData(queryKey, (prev: any) => {
        const merged = new Map<string, CarrierPickup>(
          (prev?.pickups ?? []).map((p: CarrierPickup) => [p.carrier, p])
        )
        for (const p of result.pickups) merged.set(p.carrier, p)
        return { pickups: [...merged.values()] }
      })

      const failed = result.pickups.filter((p) => !p.registered)
      if (failed.length) {
        toast.error(
          failed[0].error ||
            `Couldn't register with ${CARRIER_LABELS[failed[0].carrier]}`
        )
      } else {
        toast.success(
          `Registered with ${result.pickups
            .map((p) => CARRIER_LABELS[p.carrier])
            .join(" and ")}`
        )
      }
    },
    onError: (e: any) => toast.error(e?.message || "Registration failed"),
    onSettled: () => setPending(null),
  })

  const pickups = res?.pickups ?? []
  const busy = register.isPending || isFetching

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Carrier Pickups</Heading>
          <Text size="small" leading="compact" className="text-ui-fg-subtle mt-1">
            Register this location as a pickup point with our carriers.
          </Text>
        </div>
        {!revealed ? (
          <Button size="small" variant="secondary" onClick={() => setRevealed(true)}>
            Check status
          </Button>
        ) : (
          <Button
            size="small"
            variant="secondary"
            onClick={() => {
              setPending("all")
              register.mutate(undefined)
            }}
            isLoading={register.isPending && pending === "all"}
            disabled={busy}
          >
            Register all
          </Button>
        )}
      </div>

      {revealed && (
        <div className="px-6 py-2">
          {isFetching && !pickups.length ? (
            <div className="flex flex-col gap-y-3 py-3">
              <Skeleton className="h-6 w-64" />
              <Skeleton className="h-6 w-64" />
            </div>
          ) : isError ? (
            <Text size="small" leading="compact" className="text-ui-fg-error">
              {(error as any)?.message || "Couldn't load carrier pickup status"}
            </Text>
          ) : (
            <div className="divide-y">
              {pickups.map((p) => (
                <CarrierRow
                  key={p.carrier}
                  pickup={p}
                  isRegistering={register.isPending && pending === p.carrier}
                  disabled={busy}
                  onRegister={() => {
                    setPending(p.carrier)
                    register.mutate(p.carrier)
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "location.details.after",
})

export default CarrierPickupsWidget
