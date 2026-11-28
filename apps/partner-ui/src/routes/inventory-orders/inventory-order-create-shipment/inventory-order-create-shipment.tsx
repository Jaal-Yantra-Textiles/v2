import { useState } from "react"
import { Button, DatePicker, Heading, Input, Label, Select, Text, Textarea, toast } from "@medusajs/ui"

import { useQueryClient } from "@tanstack/react-query"

import { RouteDrawer, useRouteModal } from "../../../components/modals"
import { ordersQueryKeys } from "../../../hooks/api/orders"
import {
  useCreatePartnerInventoryOrderShipment,
  usePartnerInventoryOrderShipmentCarriers,
  usePartnerInventoryOrderShiprocketRates,
  type PartnerShipmentCarrier,
  type PartnerShiprocketRateOption,
} from "../../../hooks/api/partner-inventory-orders"
import { useInventoryActionTarget } from "../../../hooks/use-inventory-action-target"

/** DatePicker works in Date objects; the API wants "YYYY-MM-DD" (local). */
const toYMD = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`

/**
 * Used while the carrier list loads, or if it fails — the two carriers this
 * screen offered before the list came from the server.
 */
const FALLBACK_CARRIERS: PartnerShipmentCarrier[] = [
  { id: "shiprocket", label: "Shiprocket", booking: "api", rates: true, pickup: true },
  { id: "delhivery", label: "Delhivery", booking: "api", rates: false, pickup: true },
]

const NOTES_MAX = 500

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
  const [carrier, setCarrier] = useState("shiprocket")
  const [weight, setWeight] = useState("")
  const [length, setLength] = useState("")
  const [breadth, setBreadth] = useState("")
  const [height, setHeight] = useState("")
  const [courier, setCourier] = useState("")
  const [pickupDate, setPickupDate] = useState("")
  const [pickupTime, setPickupTime] = useState("14:00")
  const [rates, setRates] = useState<PartnerShiprocketRateOption[] | null>(null)
  const [notes, setNotes] = useState("")

  const { carriers: serverCarriers } = usePartnerInventoryOrderShipmentCarriers(id || "")
  const carriers =
    serverCarriers && serverCarriers.length > 0 ? serverCarriers : FALLBACK_CARRIERS
  const selected: PartnerShipmentCarrier =
    carriers.find((c) => c.id === carrier) ||
    FALLBACK_CARRIERS.find((c) => c.id === carrier) || {
      id: carrier,
      label: carrier,
      booking: "api",
      rates: false,
      pickup: false,
    }
  const isManual = selected.booking === "manual"

  const { mutateAsync, isPending } =
    useCreatePartnerInventoryOrderShipment(id || "")
  const { mutateAsync: fetchRates, isPending: isFetchingRates } =
    usePartnerInventoryOrderShiprocketRates(id || "")

  // Mirrors the admin shipment modal: L/B/H are sent as dimensions_cm so the
  // real package size reaches the courier (else it defaults to 10×10×10).
  const dims = () =>
    length || breadth || height
      ? {
          ...(length ? { length: Number(length) } : {}),
          ...(breadth ? { breadth: Number(breadth) } : {}),
          ...(height ? { height: Number(height) } : {}),
        }
      : undefined

  const handleGetRates = async () => {
    if (!id) return
    try {
      const res = await fetchRates({
        carrier,
        ...(weight ? { weight_grams: Number(weight) } : {}),
        ...(length ? { length: Number(length) } : {}),
        ...(breadth ? { breadth: Number(breadth) } : {}),
        ...(height ? { height: Number(height) } : {}),
      })
      setRates(res.rates || [])
      const recommended =
        res.rates?.find((r) => r.is_recommended) || res.rates?.[0]
      if (recommended) setCourier(String(recommended.courier_id))
      if (!res.rates?.length) toast.info("No couriers available for this route.")
    } catch (e: any) {
      toast.error(e?.message || "Failed to fetch courier rates")
    }
  }

  const invalidateOrder = () => {
    if (unifiedOrderId) {
      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.detail(unifiedOrderId),
      })
    }
  }

  const handleRequestBooking = async () => {
    if (!id) return
    const trimmed = notes.trim()
    await mutateAsync(
      {
        carrier,
        ...(weight ? { weight_grams: Number(weight) } : {}),
        ...(dims() ? { dimensions_cm: dims() } : {}),
        ...(trimmed ? { notes: trimmed.slice(0, NOTES_MAX) } : {}),
      },
      {
        onSuccess: () => {
          // Nothing is booked yet, so there is no label to open.
          toast.success("Booking requested — we'll add the AWB here")
          invalidateOrder()
          handleSuccess()
        },
        onError: (e) => {
          toast.error(e.message)
        },
      }
    )
  }

  const handleConfirm = async () => {
    if (!id) {
      return
    }
    if (isManual) {
      return handleRequestBooking()
    }

    await mutateAsync(
      {
        carrier,
        ...(weight ? { weight_grams: Number(weight) } : {}),
        ...(dims() ? { dimensions_cm: dims() } : {}),
        ...(courier && selected.rates ? { preferred_courier_id: courier } : {}),
        ...(pickupDate && selected.pickup
          ? { pickup_date: pickupDate, pickup_time: pickupTime || "14:00" }
          : {}),
      },
      {
        onSuccess: (data) => {
          const awb = data?.shipment?.awb || data?.shipment?.tracking_number
          toast.success(awb ? `Shipment created — AWB ${awb}` : "Shipment created")
          const sh = data?.shipment || {}
          if (sh.pickup?.scheduled_date) {
            toast.success(`Pickup booked for ${sh.pickup.scheduled_date} at ${pickupTime}`)
          } else if (sh.pickup_error) {
            // The carrier refused the pickup; the shipment itself is fine.
            toast.warning(`Pickup not booked: ${sh.pickup_error}. Book it from the shipment below.`)
          }
          if (sh.label_url) window.open(sh.label_url, "_blank", "noopener")
          invalidateOrder()
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
          registered pickup. Weight and dimensions are optional — leave them
          blank to use the order's defaults.
        </Text>
        <div className="flex flex-col gap-y-1">
          <Label size="small" htmlFor="carrier">
            Carrier
          </Label>
          <Select
            value={carrier}
            onValueChange={(v) => {
              setCarrier(v)
              setRates(null)
              setCourier("")
              setPickupDate("")
            }}
          >
            <Select.Trigger id="carrier">
              <Select.Value placeholder="Select carrier" />
            </Select.Trigger>
            <Select.Content>
              {carriers.map((c) => (
                <Select.Item key={c.id} value={c.id}>
                  {c.label}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
        </div>
        {isManual && (
          <div className="rounded-md border border-ui-border-base bg-ui-bg-subtle px-3 py-2">
            <Text size="small" className="text-ui-fg-subtle">
              {selected.label} is booked by our team. Send the details and
              we'll book it; the AWB and label will appear on this order,
              usually within a day.
            </Text>
          </div>
        )}
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
        <div className="grid grid-cols-3 gap-x-2">
          <div className="flex flex-col gap-y-1">
            <Label size="small" htmlFor="length">
              Length (cm)
            </Label>
            <Input
              id="length"
              type="number"
              value={length}
              onChange={(e) => setLength(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-y-1">
            <Label size="small" htmlFor="breadth">
              Breadth (cm)
            </Label>
            <Input
              id="breadth"
              type="number"
              value={breadth}
              onChange={(e) => setBreadth(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-y-1">
            <Label size="small" htmlFor="height">
              Height (cm)
            </Label>
            <Input
              id="height"
              type="number"
              value={height}
              onChange={(e) => setHeight(e.target.value)}
            />
          </div>
        </div>
        {selected.rates && (
          <div className="flex flex-col gap-y-1">
            <div className="flex items-center justify-between">
              <Label size="small" htmlFor="courier">
                Courier
              </Label>
              <Button
                variant="transparent"
                size="small"
                type="button"
                onClick={handleGetRates}
                isLoading={isFetchingRates}
                disabled={!id}
              >
                Get rates
              </Button>
            </div>
            {rates && rates.length > 0 ? (
              <Select value={courier} onValueChange={setCourier}>
                <Select.Trigger id="courier">
                  <Select.Value placeholder="Select a courier" />
                </Select.Trigger>
                <Select.Content>
                  {rates.map((r) => (
                    <Select.Item
                      key={String(r.courier_id)}
                      value={String(r.courier_id)}
                    >
                      {r.courier_name} — ₹{r.amount}
                      {r.estimated_days ? ` · ${r.estimated_days}d` : ""}
                      {r.is_recommended ? " · recommended" : ""}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
            ) : (
              <Text size="xsmall" className="text-ui-fg-subtle">
                Optional — click “Get rates” to choose a courier, or leave it for
                Shiprocket to auto-assign.
              </Text>
            )}
          </div>
        )}
        {selected.pickup && (
          <div className="flex flex-col gap-y-1">
            <Label size="small" htmlFor="pickup_date">
              Pickup date
            </Label>
            <DatePicker
              id="pickup_date"
              value={pickupDate ? new Date(`${pickupDate}T00:00:00`) : null}
              onChange={(d) => setPickupDate(d ? toYMD(d) : "")}
            />
            <Text size="xsmall" className="text-ui-fg-subtle">
              Optional — leave blank to book the pickup later from the shipment.
            </Text>
          </div>
        )}
        {selected.pickup && pickupDate && (
          <div className="flex flex-col gap-y-1">
            <Label size="small" htmlFor="pickup_time">
              Pickup time
            </Label>
            <Input
              id="pickup_time"
              type="time"
              value={pickupTime}
              onChange={(e) => setPickupTime(e.target.value)}
            />
            <Text size="xsmall" className="text-ui-fg-subtle">
              When the courier should come. Delhivery needs a time.
            </Text>
          </div>
        )}
        {isManual && (
          <div className="flex flex-col gap-y-1">
            <Label size="small" htmlFor="notes">
              Notes
            </Label>
            <Textarea
              id="notes"
              value={notes}
              maxLength={NOTES_MAX}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional — anything our team should know (parcel contents, timing…)"
            />
          </div>
        )}
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
            {isManual ? "Request booking" : "Create shipment"}
          </Button>
        </div>
      </RouteDrawer.Footer>
    </>
  )
}
