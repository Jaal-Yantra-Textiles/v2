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
].join(",")

/** The AWB already on the order, if any — the state where actions are done. */
function existingAwbOf(fulfillments: Fulfillment[]): {
  awb?: string
  carrier?: string
} {
  for (const f of fulfillments) {
    const d = f.data || {}
    const awb =
      d.waybill || d.tracking_number || f.labels?.[0]?.tracking_number || undefined
    if (awb) return { awb: String(awb), carrier: d.carrier || undefined }
  }
  return {}
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

  // Already labelled — the tracking widget below owns that state in full.
  // Render a one-line acknowledgement rather than a second set of controls that
  // would only re-ship an order that is already moving.
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
            Delhivery assigns the courier itself — there is no courier picker,
            and it serves domestic destinations only.
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
