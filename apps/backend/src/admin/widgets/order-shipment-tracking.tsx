import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { DetailWidgetProps } from "@medusajs/framework/types"
import {
  Badge,
  Button,
  Container,
  Copy,
  Heading,
  Skeleton,
  StatusBadge,
  Text,
} from "@medusajs/ui"
import {
  ArrowUpRightOnBox,
  DocumentText,
  TriangleRightMini,
  TruckFast,
} from "@medusajs/icons"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { sdk } from "../lib/config"

// #1118 — surface the Shiprocket shipment on the admin ORDER detail: the
// auto-selected courier + its quoted rate (`data.provider_refs.courier_rate`,
// stamped for international orders in #1116 S3) and the tracking timeline
// (`data.tracking_events`, appended by the #1117 core-order webhook sync).
// Mirrors the inventory-order shipments section, but reads core-order
// fulfillments and uses Medusa UI primitives throughout. Orders with no
// carrier shipment (plain retail with no AWB) render nothing — no empty card.

type FulfillmentLabel = {
  tracking_number?: string | null
  tracking_url?: string | null
  label_url?: string | null
}

type ProviderRefs = {
  courier_name?: string | null
  courier_rate?: number | null
  courier_rate_currency?: string | null
  international?: boolean | null
}

type TrackingEvent = {
  at?: string | null
  received_at?: string | null
  status?: string | null
  status_code?: number | string | null
  location?: string | null
}

type FulfillmentData = {
  carrier?: string | null
  waybill?: string | null
  tracking_number?: string | null
  tracking_url?: string | null
  label_url?: string | null
  current_status?: string | null
  provider_refs?: ProviderRefs | null
  tracking_events?: TrackingEvent[] | null
}

type Fulfillment = {
  id: string
  shipped_at?: string | null
  delivered_at?: string | null
  canceled_at?: string | null
  data?: FulfillmentData | null
  labels?: FulfillmentLabel[] | null
}

type AdminOrder = { id: string }

type OrderResponse = { order: { id: string; fulfillments?: Fulfillment[] } }

const FIELDS = [
  "id",
  "fulfillments.id",
  "fulfillments.shipped_at",
  "fulfillments.delivered_at",
  "fulfillments.canceled_at",
  "fulfillments.data",
  "fulfillments.labels.tracking_number",
  "fulfillments.labels.tracking_url",
  "fulfillments.labels.label_url",
].join(",")

/** A fulfillment counts as a carrier shipment only once it carries carrier refs. */
function isCarrierShipment(f: Fulfillment): boolean {
  const d = f.data || {}
  return Boolean(
    d.carrier || d.waybill || d.tracking_number || d.provider_refs
  )
}

/** Derive a human status + StatusBadge color from timestamps and the carrier status. */
function deriveStatus(f: Fulfillment): {
  label: string
  color: "green" | "orange" | "blue" | "red" | "grey"
} {
  if (f.canceled_at) return { label: "Cancelled", color: "red" }
  if (f.delivered_at) return { label: "Delivered", color: "green" }

  const raw = (f.data?.current_status || "").toLowerCase()
  if (raw) {
    if (raw.includes("deliver")) return { label: f.data!.current_status!, color: "green" }
    if (raw.includes("rto") || raw.includes("return") || raw.includes("cancel"))
      return { label: f.data!.current_status!, color: "red" }
    if (raw.includes("out for delivery"))
      return { label: f.data!.current_status!, color: "orange" }
    return { label: f.data!.current_status!, color: "blue" }
  }

  if (f.shipped_at) return { label: "In transit", color: "blue" }
  return { label: "Awaiting pickup", color: "orange" }
}

function formatMoney(amount: number, currency?: string | null): string {
  const cur = (currency || "INR").toUpperCase()
  const safe = Number.isFinite(amount) ? amount : 0
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: cur,
      maximumFractionDigits: 2,
    }).format(safe)
  } catch {
    return `${safe.toFixed(2)} ${cur}`
  }
}

const linkOf = (f: Fulfillment) => {
  const d = f.data || {}
  const label = (f.labels || [])[0] || {}
  const awb = d.tracking_number || d.waybill || label.tracking_number || undefined
  const trackingUrl = d.tracking_url || label.tracking_url || undefined
  const labelUrl = d.label_url || label.label_url || undefined
  return { awb, trackingUrl, labelUrl }
}

const TrackingTimeline = ({ events }: { events: TrackingEvent[] }) => {
  const [open, setOpen] = useState(false)
  if (events.length === 0) return null
  return (
    <div className="pl-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-x-1 text-ui-fg-subtle transition-colors hover:text-ui-fg-base"
      >
        <TriangleRightMini
          className={`text-ui-fg-muted transition-transform ${open ? "rotate-90" : ""}`}
        />
        <Text size="xsmall" leading="compact">
          Tracking history ({events.length})
        </Text>
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-y-1 border-l border-ui-border-base pl-3">
          {[...events].reverse().map((ev, idx) => {
            const when = ev.at || ev.received_at
            return (
              <div key={idx} className="flex flex-col">
                <Text size="xsmall" leading="compact" className="text-ui-fg-base">
                  {ev.status || "—"}
                  {ev.status_code != null && ev.status_code !== ""
                    ? ` (${ev.status_code})`
                    : ""}
                </Text>
                <Text size="xsmall" leading="compact" className="text-ui-fg-muted">
                  {when ? new Date(when).toLocaleString() : ""}
                  {ev.location ? ` · ${ev.location}` : ""}
                </Text>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const ShipmentRow = ({ f }: { f: Fulfillment }) => {
  const status = deriveStatus(f)
  const { awb, trackingUrl, labelUrl } = linkOf(f)
  const refs = f.data?.provider_refs || {}
  const events = Array.isArray(f.data?.tracking_events)
    ? (f.data!.tracking_events as TrackingEvent[])
    : []
  const carrierName = f.data?.carrier || "Shiprocket"
  const hasRate = refs.courier_rate != null && Number.isFinite(Number(refs.courier_rate))

  return (
    <div className="flex flex-col gap-y-2 py-4">
      <div className="flex items-center justify-between gap-x-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <StatusBadge color={status.color} className="text-nowrap capitalize">
            {status.label}
          </StatusBadge>
          <Text size="small" leading="compact" className="text-ui-fg-base capitalize">
            {carrierName}
          </Text>
          {refs.international ? (
            <Badge size="2xsmall" color="purple">
              International
            </Badge>
          ) : null}
        </div>
        {labelUrl ? (
          <Button size="small" variant="secondary" asChild>
            <a href={labelUrl} target="_blank" rel="noreferrer">
              <DocumentText />
              Label
            </a>
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-1">
        {refs.courier_name ? (
          <Text size="xsmall" leading="compact" className="text-ui-fg-subtle">
            Courier: {refs.courier_name}
          </Text>
        ) : null}
        {hasRate ? (
          <Text size="xsmall" leading="compact" className="text-ui-fg-subtle">
            Rate: {formatMoney(Number(refs.courier_rate), refs.courier_rate_currency)}
          </Text>
        ) : null}
      </div>

      {awb ? (
        <div className="flex items-center gap-x-2 pl-1">
          <Text size="xsmall" leading="compact" className="text-ui-fg-muted">
            AWB
          </Text>
          {trackingUrl ? (
            <a
              href={trackingUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-x-1 text-ui-fg-interactive transition-colors hover:text-ui-fg-interactive-hover"
            >
              <Text size="xsmall" leading="compact">
                {awb}
              </Text>
              <ArrowUpRightOnBox />
            </a>
          ) : (
            <Text size="xsmall" leading="compact" className="text-ui-fg-base">
              {awb}
            </Text>
          )}
          <Copy content={awb} variant="mini" />
        </div>
      ) : null}

      <TrackingTimeline events={events} />
    </div>
  )
}

const OrderShipmentTrackingWidget = ({
  data: order,
}: DetailWidgetProps<AdminOrder>) => {
  const { data, isLoading } = useQuery({
    queryFn: () =>
      sdk.client.fetch<OrderResponse>(`/admin/orders/${order.id}`, {
        method: "GET",
        query: { fields: FIELDS },
      }),
    queryKey: ["order-shipment-tracking", order.id],
  })

  const shipments = (data?.order?.fulfillments || []).filter(isCarrierShipment)

  // No carrier shipment → plain retail order with no AWB → render nothing.
  // (Match the widget-convention: no empty card on unrelated orders.)
  if (!isLoading && shipments.length === 0) return null

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-2">
          <TruckFast className="text-ui-fg-subtle" />
          <Heading level="h2">Shipping &amp; Tracking</Heading>
          {shipments.length > 0 ? (
            <Badge size="2xsmall" className="ml-1">
              {shipments.length}
            </Badge>
          ) : null}
        </div>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-y-3 px-6 py-4">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-4 w-52" />
        </div>
      ) : (
        <div className="flex flex-col divide-y px-6 py-2">
          {shipments.map((f) => (
            <ShipmentRow key={f.id} f={f} />
          ))}
        </div>
      )}
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "order.details.after",
})

export default OrderShipmentTrackingWidget
