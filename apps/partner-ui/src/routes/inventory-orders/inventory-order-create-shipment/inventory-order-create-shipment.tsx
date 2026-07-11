import { useState } from "react"
import { Button, DatePicker, Heading, Input, Label, Select, Text, toast } from "@medusajs/ui"

import { useQueryClient } from "@tanstack/react-query"

import { RouteDrawer, useRouteModal } from "../../../components/modals"
import { ordersQueryKeys } from "../../../hooks/api/orders"
import {
  useCreatePartnerInventoryOrderShipment,
  usePartnerInventoryOrderShiprocketRates,
  type PartnerShiprocketRateOption,
} from "../../../hooks/api/partner-inventory-orders"
import { useInventoryActionTarget } from "../../../hooks/use-inventory-action-target"

/** DatePicker works in Date objects; the API wants "YYYY-MM-DD" (local). */
const toYMD = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`

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
  const [rates, setRates] = useState<PartnerShiprocketRateOption[] | null>(null)

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

  const handleConfirm = async () => {
    if (!id) {
      return
    }

    await mutateAsync(
      {
        carrier,
        ...(weight ? { weight_grams: Number(weight) } : {}),
        ...(dims() ? { dimensions_cm: dims() } : {}),
        ...(courier ? { preferred_courier_id: courier } : {}),
        ...(pickupDate ? { pickup_date: pickupDate } : {}),
      },
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
          registered pickup. Weight and dimensions are optional — leave them
          blank to use the order's defaults.
        </Text>
        <div className="flex flex-col gap-y-1">
          <Label size="small" htmlFor="carrier">
            Carrier
          </Label>
          <Select value={carrier} onValueChange={(v) => { setCarrier(v); setRates(null); setCourier(""); }}>
            <Select.Trigger id="carrier">
              <Select.Value placeholder="Select carrier" />
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="shiprocket">Shiprocket</Select.Item>
              <Select.Item value="delhivery">Delhivery</Select.Item>
            </Select.Content>
          </Select>
        </div>
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
        {carrier === "shiprocket" && (
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
            Optional — leave blank to let the courier pick the earliest slot.
          </Text>
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
