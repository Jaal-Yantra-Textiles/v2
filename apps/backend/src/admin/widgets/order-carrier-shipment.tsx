import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { DetailWidgetProps } from "@medusajs/framework/types"
import {
  Badge,
  Button,
  Container,
  Heading,
  Input,
  Label,
  Select,
  Skeleton,
  Text,
  toast,
} from "@medusajs/ui"
import { ArrowUpRightOnBox, TruckFast } from "@medusajs/icons"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { sdk } from "../lib/config"
import {
  carrierLabel,
  carriersForDestination,
  resolveSelectableCarrier,
} from "../lib/shipment-carriers"
import {
  useAttachShiprocketAwb,
  useCancelShipment,
  useGenerateShiprocketLabel,
  useShiprocketRates,
} from "../hooks/api/design-orders"

/**
 * #649 P3 — drive Shiprocket / Delhivery from a RETAIL order in admin.
 *
 * Every backend piece already existed (`/admin/orders/:id/shiprocket-label`,
 * `…/shiprocket-rates`, `…/shiprocket-attach-awb`, all carrier-neutral via
 * `resolveShippingProvider`), but the only UI that called them was the custom
 * **Design Orders** page. On a normal order an admin could see a shipment
 * (`order-shipment-tracking`, read-only) and never create one — the carrier
 * flow was reachable only for orders that came from a design.
 *
 * This is the missing action half, deliberately kept as a sibling of the
 * tracking widget rather than folded into it: one renders the after-state, this
 * one renders the actions, and each disappears when it has nothing to say.
 *
 * It does NOT mark the order shipped. Every fulfillment here goes out through
 * the manual shipping side-channel; generating a label is a carrier act, and the
 * parcel isn't shipped until someone hands it over. Same semantics as the
 * partner portal's carrier step.
 */

type AdminOrder = { id: string }

type Fulfillment = {
  id: string
  data?: Record<string, any> | null
  labels?: Array<{ tracking_number?: string | null }> | null
}

type OrderResponse = {
  order: {
    id: string
    shipping_address?: { country_code?: string | null } | null
    fulfillments?: Fulfillment[]
  }
}

const FIELDS = [
  "id",
  "shipping_address.country_code",
  "fulfillments.id",
  "fulfillments.data",
  "fulfillments.labels.tracking_number",
  // The booked pickup lives here. Without it the widget could only know about a
  // pickup it had booked itself, in this tab, since the last refresh.
  "fulfillments.metadata",
].join(",")

/** A pickup already booked with the carrier, as persisted by the pickup route. */
type BookedPickup = {
  pickup_id?: string
  pickup_date: string
  pickup_time: string
  incoming_center_name?: string
}

/**
 * What the carrier calls the pickup's handle.
 *
 * Blue Dart returns it as `TokenNumber` and its phone agents ask for the "token
 * number"; a label reading "Reference" sends the operator hunting for a field
 * that does not exist on the carrier's side. It is also the ONLY thing that can
 * cancel a collection — cancelling the waybill does not.
 */
function pickupCodeLabel(carrier?: string): string {
  return String(carrier || "").toLowerCase() === "bluedart"
    ? "Pickup token"
    : "Reference"
}

function bookedPickupOf(fulfillment: any): BookedPickup | null {
  const m = fulfillment?.metadata
  // `pickup_date` is the load-bearing field: Blue Dart hands back a
  // `TokenNumber` and some carriers hand back nothing identifying at all, so a
  // booking with no id is still a booking — a courier is still coming.
  if (!m?.pickup_date) return null
  return {
    pickup_id: m.pickup_id,
    pickup_date: m.pickup_date,
    pickup_time: m.pickup_time,
    incoming_center_name: m.incoming_center_name,
  }
}

/** The AWB already on the order, if any — the state where actions are done. */
/** Tomorrow, as YYYY-MM-DD — the earliest slot a packer can realistically make. */
function defaultPickupDate(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

function existingAwbOf(fulfillments: Fulfillment[]): {
  awb?: string
  carrier?: string
  fulfillmentId?: string
} {
  for (const f of fulfillments) {
    const d = f.data || {}
    const live = d.waybill || d.tracking_number || undefined
    // A cancelled shipment clears the carrier refs from `data` but the label row
    // is a separate table. Trusting the label alone would keep showing a voided
    // AWB and lock the widget in its "already labelled" branch — exactly the
    // re-label this feature exists to allow. Once anything has been cancelled
    // here, `data` is the only authority.
    const cancelledBefore = Array.isArray(d.cancelled_shipments)
      ? d.cancelled_shipments.length > 0
      : false
    const awb =
      live || (cancelledBefore ? undefined : f.labels?.[0]?.tracking_number)
    if (awb) {
      return { awb: String(awb), carrier: d.carrier || undefined, fulfillmentId: f.id }
    }
  }
  return {}
}

/** "2026-08-14" + "14:00" → "14 Aug, 14:00". Falls back to the raw values. */
function formatPickupWhen(date: string, time?: string): string {
  const d = new Date(`${date}T00:00:00`)
  if (Number.isNaN(d.getTime())) return [date, time].filter(Boolean).join(" ")
  const day = d.toLocaleDateString("en-IN", { day: "numeric", month: "short" })
  return time ? `${day}, ${time}` : day
}

/** Empty string → undefined, else a positive number (a blank is not 0 grams). */
const positive = (v: string): number | undefined => {
  if (!v.trim()) return undefined
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

function formatMoney(amount: number, currency?: string | null): string {
  const cur = (currency || "INR").toUpperCase()
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: cur,
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${cur}`
  }
}

const OrderCarrierShipmentWidget = ({
  data: order,
}: DetailWidgetProps<AdminOrder>) => {
  const { data, isLoading, refetch } = useQuery({
    queryFn: () =>
      sdk.client.fetch<OrderResponse>(`/admin/orders/${order.id}`, {
        method: "GET",
        query: { fields: FIELDS },
      }),
    queryKey: ["order-carrier-shipment", order.id],
  })

  const destinationCountry = data?.order?.shipping_address?.country_code
  const fulfillments = data?.order?.fulfillments || []
  const existing = existingAwbOf(fulfillments)

  const availableCarriers = carriersForDestination(destinationCountry)
  const [carrierChoice, setCarrierChoice] = useState<string | undefined>(undefined)
  const carrier = resolveSelectableCarrier(carrierChoice, destinationCountry)
  const isShiprocket = carrier === "shiprocket"

  // Pickup booking. Separate from label creation on purpose: a waybill can be
  // made the night before, but a pickup slot is a real-world commitment for a
  // date, a package count and a warehouse.
  const [pickupDate, setPickupDate] = useState(defaultPickupDate())
  const [pickupTime, setPickupTime] = useState("14:00")
  const [packageCount, setPackageCount] = useState("1")
  const [schedulingPickup, setSchedulingPickup] = useState(false)

  // Server state, not local state. This used to be a `useState` set only by our
  // own booking call, so a refresh — or an admin opening the order in a second
  // tab, or a pickup a partner booked — showed an empty form for a collection
  // that was already scheduled, inviting a duplicate booking.
  const pickupFulfillment = fulfillments.find(
    (f: any) => f.id === existing.fulfillmentId
  )
  const pickup = bookedPickupOf(pickupFulfillment)

  const schedulePickup = async (fulfillmentId: string) => {
    if (!pickupDate || !pickupTime) {
      toast.error("Pick a date and a time first")
      return
    }
    setSchedulingPickup(true)
    try {
      const res = await sdk.client.fetch<{
        pickup_id?: string
        pickup_persisted?: boolean
      }>(
        `/admin/orders/${order.id}/fulfillments/${fulfillmentId}/pickup`,
        {
          method: "POST",
          body: {
            pickup_date: pickupDate,
            pickup_time: pickupTime,
            expected_package_count: Number(packageCount) || 1,
          },
        }
      )
      // Refetch rather than set local state: the route is the thing that knows
      // whether the booking was actually persisted.
      await refetch()
      if (res?.pickup_persisted === false) {
        // Booked at the carrier but not saved. Saying "scheduled" here would be
        // a lie by omission — the collection is live and its cancellation token
        // is now only in the server log.
        toast.warning(
          `Pickup booked with the carrier${
            res?.pickup_id ? ` (#${res.pickup_id})` : ""
          }, but it could not be saved to this order. Note the reference — cancelling it later may need a phone call.`
        )
      } else {
        toast.success("Pickup scheduled")
      }
    } catch (e: any) {
      toast.error(e?.message || "Could not schedule the pickup")
    } finally {
      setSchedulingPickup(false)
    }
  }

  // Parcel. Blank means "let the backend default it", which is how retail labels
  // used to ship at 500 g regardless of the box.
  const [weight, setWeight] = useState("")
  const [length, setLength] = useState("")
  const [width, setWidth] = useState("")
  const [height, setHeight] = useState("")
  const weightGrams = positive(weight)
  const lengthCm = positive(length)
  const widthCm = positive(width)
  const heightCm = positive(height)
  const dimensionsCm =
    lengthCm && widthCm && heightCm
      ? { length: lengthCm, width: widthCm, height: heightCm }
      : undefined

  // Courier picker (#641). Shiprocket-only — Delhivery auto-assigns and exposes
  // no courier list. Fetched on demand: the request hits the live carrier.
  const [ratesRequested, setRatesRequested] = useState(false)
  const [courierId, setCourierId] = useState<string>("")
  const {
    data: ratesData,
    isFetching: ratesLoading,
    error: ratesError,
  } = useShiprocketRates(
    order.id,
    { carrier, weightGrams, lengthCm, widthCm, heightCm },
    { enabled: ratesRequested && isShiprocket && !existing.awb }
  )

  const [labelUrl, setLabelUrl] = useState<string | null>(null)
  const [awbInput, setAwbInput] = useState("")

  // Cancelling a waybill. Two-step on purpose: it costs money at the carrier and
  // cannot be undone, so the reason field doubles as the confirmation gesture.
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState("")
  const { mutateAsync: cancelShipment, isPending: isCancelling } =
    useCancelShipment(order.id)

  const handleCancel = async (fulfillmentId: string) => {
    await cancelShipment(
      { fulfillmentId, reason: cancelReason.trim() || undefined },
      {
        onSuccess: (res) => {
          const c = res.cancelled_shipment
          toast.success(
            `AWB ${c.awb} cancelled${
              c.customer_notified ? " — customer emailed" : ""
            }`
          )
          // Say what it was worth. The freight deduction is invisible on this
          // widget (it lives on the payout panel), so without this the operator
          // has no signal that the partner's payout just moved.
          if (c.shipping_reversed) {
            toast.info(
              `Reversed ${c.shipping_reversed.amount} ${c.shipping_reversed.currency_code} of platform shipping on the partner's payout.`
            )
          }
          if (!c.customer_notified) {
            // Never silent: the whole point of the email is that the customer
            // finds out from us rather than from a dead tracking link.
            toast.warning(
              "The customer was NOT emailed about the courier change — send them a note by hand."
            )
          }
          setCancelOpen(false)
          setCancelReason("")
          setLabelUrl(null)
          // The pickup is NOT cancelled by cancelling the waybill — they are
          // separate bookings at the carrier, exactly as creating them is. A
          // voided AWB with a live collection means a courier arrives for a
          // parcel that no longer has a manifest.
          if (pickup) {
            toast.warning(
              `The ${pickup.pickup_date} pickup is still booked${
                pickup.pickup_id ? ` (#${pickup.pickup_id})` : ""
              } — cancel it with the carrier, or a courier will still arrive.`
            )
          }
          refetch()
        },
        onError: (e) => toast.error(e.message),
      }
    )
  }

  const { mutateAsync: generateLabel, isPending: isGenerating } =
    useGenerateShiprocketLabel(order.id)
  const { mutateAsync: attachAwb, isPending: isAttaching } =
    useAttachShiprocketAwb(order.id)

  const handleGenerate = async () => {
    await generateLabel(
      {
        carrier,
        ...(courierId ? { preferred_courier_id: courierId } : {}),
        ...(weightGrams ? { weight_grams: weightGrams } : {}),
        ...(dimensionsCm ? { dimensions_cm: dimensionsCm } : {}),
      },
      {
        onSuccess: (res) => {
          setLabelUrl(res.shiprocket_label?.label_url || null)
          toast.success(
            res.shiprocket_label?.awb
              ? `Label generated (AWB ${res.shiprocket_label.awb})`
              : "Shipment created"
          )
          refetch()
        },
        onError: (e) => toast.error(e.message),
      }
    )
  }

  const handleAttach = async () => {
    const awb = awbInput.trim()
    if (!awb) return
    await attachAwb(awb, {
      onSuccess: () => {
        toast.success(`AWB ${awb} attached`)
        setAwbInput("")
        refetch()
      },
      onError: (e) => toast.error(e.message),
    })
  }

  if (isLoading) {
    return (
      <Container className="divide-y p-0">
        <div className="flex flex-col gap-y-3 px-6 py-4">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
      </Container>
    )
  }

  // Already labelled — the tracking widget below owns that state in full, so
  // this stays an acknowledgement rather than a second set of shipping controls.
  // The one thing that DOES still need doing is booking the pickup: a waybill
  // only tells the carrier a parcel exists, not to come and collect it. Order #83
  // sat two days waiting for a pickup booked by hand on Delhivery's dashboard.
  if (existing.awb) {
    return (
      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-x-2">
            <TruckFast className="text-ui-fg-subtle" />
            <Heading level="h2">Carrier Shipment</Heading>
          </div>
          <Badge size="2xsmall" color="green">
            {carrierLabel(existing.carrier)} · {existing.awb}
          </Badge>
        </div>

        {existing.fulfillmentId ? (
          <div className="flex flex-col gap-y-3 px-6 py-4">
            {pickup ? (
              <div className="flex flex-col gap-y-1">
                <div className="flex items-center gap-x-2">
                  <Badge size="2xsmall" color="green">
                    Pickup booked
                  </Badge>
                  <Text size="small">
                    {formatPickupWhen(pickup.pickup_date, pickup.pickup_time)}
                  </Text>
                </div>
                <Text size="small" className="text-ui-fg-subtle">
                  {pickup.pickup_id
                    ? // Shown, not hidden behind a tooltip: for Blue Dart this
                      // token is the only handle that can call the collection
                      // off, and an operator on the phone to the carrier needs
                      // to be able to read it out. Named by what the carrier
                      // calls it, because that is the word the agent on the
                      // phone will ask for — Blue Dart says "token number".
                      `${pickupCodeLabel(existing.carrier)} #${pickup.pickup_id}`
                    : "No reference returned by the carrier — cancelling may need a phone call."}
                  {pickup.incoming_center_name
                    ? ` · ${pickup.incoming_center_name}`
                    : ""}
                </Text>
              </div>
            ) : (
              <Text size="small" className="text-ui-fg-subtle">
                The label exists, but the carrier won't collect until a pickup is
                booked.
              </Text>
            )}
            {!pickup ? (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <div className="flex flex-col gap-y-1">
                    <Label size="small" htmlFor="pickup_date">
                      Pickup date
                    </Label>
                    <Input
                      id="pickup_date"
                      type="date"
                      value={pickupDate}
                      onChange={(e) => setPickupDate(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-y-1">
                    <Label size="small" htmlFor="pickup_time">
                      Time
                    </Label>
                    <Input
                      id="pickup_time"
                      type="time"
                      value={pickupTime}
                      onChange={(e) => setPickupTime(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-y-1">
                    <Label size="small" htmlFor="package_count">
                      Packages
                    </Label>
                    <Input
                      id="package_count"
                      type="number"
                      min={1}
                      value={packageCount}
                      onChange={(e) => setPackageCount(e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <Button
                    variant="secondary"
                    size="small"
                    isLoading={schedulingPickup}
                    onClick={() => schedulePickup(existing.fulfillmentId!)}
                  >
                    Schedule pickup
                  </Button>
                  <Text size="xsmall" className="text-ui-fg-subtle mt-1">
                    Books a real collection slot with {carrierLabel(existing.carrier)}.
                    Only book it once the parcel is actually packed.
                  </Text>
                </div>
              </>
            ) : null}

            {/* Something went wrong with this booking — void it and start over. */}
            <div className="flex flex-col gap-y-2 border-t pt-4">
              {!cancelOpen ? (
                <div>
                  <Button
                    variant="danger"
                    size="small"
                    onClick={() => setCancelOpen(true)}
                  >
                    Cancel waybill
                  </Button>
                  <Text size="xsmall" className="text-ui-fg-subtle mt-1">
                    For a pickup that never happened, a partner change, or an
                    address caught late. Frees the order to be re-labelled with
                    another carrier.
                  </Text>
                </div>
              ) : (
                <>
                  <Label size="small" htmlFor="cancel_reason">
                    Why is this being cancelled?
                  </Label>
                  <Input
                    id="cancel_reason"
                    placeholder="e.g. pickup no-show three days running"
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                  />
                  <Text size="xsmall" className="text-ui-fg-subtle">
                    Kept on the fulfillment for reconciling the carrier invoice.
                    The customer is emailed that we've moved them to another
                    courier — they are not shown this reason.
                  </Text>
                  <div className="flex items-center gap-x-2">
                    <Button
                      variant="danger"
                      size="small"
                      isLoading={isCancelling}
                      onClick={() => handleCancel(existing.fulfillmentId!)}
                    >
                      Cancel AWB {existing.awb}
                    </Button>
                    <Button
                      variant="secondary"
                      size="small"
                      disabled={isCancelling}
                      onClick={() => {
                        setCancelOpen(false)
                        setCancelReason("")
                      }}
                    >
                      Keep it
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        ) : null}
      </Container>
    )
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-2">
          <TruckFast className="text-ui-fg-subtle" />
          <Heading level="h2">Carrier Shipment</Heading>
        </div>
      </div>

      <div className="flex flex-col gap-y-4 px-6 py-4">
        <Text size="small" className="text-ui-fg-subtle">
          Generate a real carrier label (AWB) for this order, or attach one that
          was booked outside the system. This does not mark the order shipped —
          hand the parcel over first, then mark it shipped as usual.
        </Text>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-y-1">
            <Label size="small" htmlFor="carrier">
              Carrier
            </Label>
            <Select
              value={carrier}
              onValueChange={(v) => {
                setCarrierChoice(v)
                // A quote belongs to the carrier that produced it.
                setRatesRequested(false)
                setCourierId("")
              }}
            >
              <Select.Trigger id="carrier">
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                {availableCarriers.map((c) => (
                  <Select.Item key={c.value} value={c.value}>
                    {c.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
          </div>
          <div className="flex flex-col gap-y-1">
            <Label size="small" htmlFor="weight_grams">
              Weight (g)
            </Label>
            <Input
              id="weight_grams"
              type="number"
              min={1}
              placeholder="500"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {(
            [
              ["Length (cm)", length, setLength],
              ["Width (cm)", width, setWidth],
              ["Height (cm)", height, setHeight],
            ] as const
          ).map(([label, value, set]) => (
            <div key={label} className="flex flex-col gap-y-1">
              <Label size="small">{label}</Label>
              <Input
                type="number"
                min={1}
                placeholder="—"
                value={value}
                onChange={(e) => set(e.target.value)}
              />
            </div>
          ))}
        </div>

        {isShiprocket ? (
          <div className="flex flex-col gap-y-2">
            {!ratesRequested ? (
              <div>
                <Button
                  variant="secondary"
                  size="small"
                  onClick={() => setRatesRequested(true)}
                >
                  Compare couriers
                </Button>
                <Text size="xsmall" className="text-ui-fg-subtle mt-1">
                  Optional — quotes the parcel above against the live carrier.
                  Skip it and the carrier auto-selects.
                </Text>
              </div>
            ) : ratesLoading ? (
              <Skeleton className="h-9 w-full" />
            ) : ratesError ? (
              <Text size="small" className="text-ui-fg-error">
                {(ratesError as Error).message}
              </Text>
            ) : (
              <div className="flex flex-col gap-y-1">
                <Label size="small" htmlFor="courier">
                  Courier
                </Label>
                <Select value={courierId} onValueChange={setCourierId}>
                  <Select.Trigger id="courier">
                    <Select.Value placeholder="Auto-select" />
                  </Select.Trigger>
                  <Select.Content>
                    {(ratesData?.rates || []).map((r) => (
                      <Select.Item
                        key={String(r.courier_id)}
                        value={String(r.courier_id)}
                      >
                        {r.courier_name} · {formatMoney(r.amount, r.currency_code)}
                        {r.estimated_days ? ` · ${r.estimated_days}d` : ""}
                        {r.is_recommended ? " · recommended" : ""}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select>
              </div>
            )}
          </div>
        ) : (
          <Text size="xsmall" className="text-ui-fg-subtle">
            {carrier === "bluedart"
              ? "Blue Dart carries the parcel itself — there is no courier picker. It serves international destinations too, on its IPC export product."
              : "Delhivery assigns the courier itself — there is no courier picker, and it serves domestic destinations only."}
          </Text>
        )}

        <div className="flex items-center gap-x-2">
          <Button
            variant="primary"
            size="small"
            isLoading={isGenerating}
            onClick={handleGenerate}
          >
            Generate label
          </Button>
          {labelUrl ? (
            <Button variant="secondary" size="small" asChild>
              <a href={labelUrl} target="_blank" rel="noreferrer">
                <ArrowUpRightOnBox className="mr-1 h-4 w-4" />
                Open label
              </a>
            </Button>
          ) : null}
        </div>

        <div className="flex flex-col gap-y-1 border-t pt-4">
          <Label size="small" htmlFor="awb">
            Already booked elsewhere?
          </Label>
          <div className="flex items-center gap-x-2">
            <Input
              id="awb"
              placeholder="Existing AWB"
              value={awbInput}
              onChange={(e) => setAwbInput(e.target.value)}
            />
            <Button
              variant="secondary"
              size="small"
              disabled={!awbInput.trim()}
              isLoading={isAttaching}
              onClick={handleAttach}
            >
              Attach
            </Button>
          </div>
          <Text size="xsmall" className="text-ui-fg-subtle">
            Looks the AWB up read-only and stamps it onto the fulfillment, so
            tracking flows in as if we had booked it.
          </Text>
        </div>
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  // Directly above the read-only tracking widget (`order.details.after`), so the
  // action and its result read as one section.
  zone: "order.details.after",
})

export default OrderCarrierShipmentWidget
