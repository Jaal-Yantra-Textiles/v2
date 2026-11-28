import { Button, Container, DatePicker, Heading, Input, StatusBadge, Text, toast } from "@medusajs/ui"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import { useDate } from "../../hooks/use-date"
import {
  useBookInventoryShipmentPickup,
  useInventoryShipmentLabel,
} from "../../hooks/api/partner-inventory-orders"
import { carrierLabel, isBookingPending } from "../../lib/carrier-label"
import { getStatusBadgeColor } from "../../lib/status-badge"
import { getStylizedAmount } from "../../lib/money-amount-helpers"

const fmtQty = (n: number) => {
  if (!Number.isFinite(n)) return "0"
  return String(Math.round(n * 1000) / 1000)
}

/**
 * #342 — Fulfillments section for an inventory work-order, mirroring retail's
 * standalone `OrderFulfillmentSection`. Each delivery (line_fulfillment) is a
 * row: item · quantity · date.
 */
export const InventoryFulfillmentsSection = ({
  orderLines,
}: {
  orderLines: Array<Record<string, any>>
}) => {
  const { t } = useTranslation()
  const { getFullDate } = useDate()

  const events: Array<{ id: string; title: string; quantity: number; date?: string }> = []
  for (const line of orderLines) {
    const title =
      line?.inventory_items?.[0]?.title ||
      line?.inventory_items?.[0]?.name ||
      line?.inventory_item_id ||
      line?.id
    for (const f of (line?.line_fulfillments || []) as any[]) {
      const quantity = Number(f?.quantity_delta) || 0
      // Skip null/empty fulfillment rows and zero-delta entries.
      if (!f || quantity <= 0) continue
      events.push({
        id: String(f?.id ?? `${line.id}-${events.length}`),
        title: String(title),
        quantity,
        date: f?.created_at,
      })
    }
  }
  events.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">{t("partner.workOrders.fulfillments")}</Heading>
      </div>
      {events.length === 0 ? (
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">
            {t("partner.workOrders.noFulfillments")}
          </Text>
        </div>
      ) : (
        events.map((e) => (
          <div key={e.id} className="flex flex-col gap-y-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <Text size="small" weight="plus" className="truncate">
                {e.title}
              </Text>
              {e.date && (
                <Text size="xsmall" className="text-ui-fg-subtle">
                  {t("partner.workOrders.delivered")} · {getFullDate({ date: e.date, includeTime: true })}
                </Text>
              )}
            </div>
            <Text size="small">+{fmtQty(e.quantity)}</Text>
          </div>
        ))
      )}
    </Container>
  )
}

/**
 * #342 — Payments section for an inventory work-order, mirroring retail's
 * standalone `OrderPaymentSection`. Lists submitted payments (amount · type ·
 * date) with a status badge.
 */
export const InventoryPaymentsSection = ({
  payments,
  currencyCode,
}: {
  payments: Array<Record<string, any>>
  currencyCode?: string
}) => {
  const { t } = useTranslation()
  const { getFullDate } = useDate()
  const cc = (currencyCode || "").toLowerCase()
  const money = (amount: number) =>
    cc ? getStylizedAmount(amount, cc) : String(amount)

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">{t("partner.workOrders.payments")}</Heading>
      </div>
      {payments.length === 0 ? (
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">
            {t("partner.workOrders.noPayments")}
          </Text>
        </div>
      ) : (
        payments.map((p, idx) => (
          <div key={String(p.id ?? idx)} className="flex flex-col gap-y-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <Text size="small" weight="plus">
                {money(Number(p.amount) || 0)}
              </Text>
              <Text size="xsmall" className="text-ui-fg-subtle">
                {String(p.payment_type || "").replace(/_/g, " ")}
                {p.payment_date ? ` · ${getFullDate({ date: p.payment_date, includeTime: true })}` : ""}
              </Text>
            </div>
            {p.status && (
              <StatusBadge color={getStatusBadgeColor(String(p.status))} className="text-nowrap">
                {String(p.status).replace(/_/g, " ")}
              </StatusBadge>
            )}
          </div>
        ))
      )}
    </Container>
  )
}

/**
 * #888 — Upcoming-pickup card for an inventory work-order. Surfaces shipments
 * with a scheduled pickup (status 'pickup_scheduled' + pickup_scheduled_date) so
 * the partner sees "a courier is coming" at a glance: date, pickup location, AWB.
 */
export const InventoryUpcomingPickupCard = ({
  shipments,
}: {
  shipments: Array<Record<string, any>>
}) => {
  const { t } = useTranslation()
  const { getFullDate } = useDate()

  // A booking_pending row (India Post, booked by our team) has no pickup and
  // no AWB yet — it must never read as "a courier is coming".
  const upcoming = shipments.filter(
    (s) =>
      !isBookingPending(s) &&
      String(s?.status || "").toLowerCase() === "pickup_scheduled" &&
      !!s?.pickup_scheduled_date
  )

  if (upcoming.length === 0) return null

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">{t("partner.workOrders.upcomingPickup")}</Heading>
      </div>
      {upcoming.map((s, idx) => {
        const awb = s.awb || s.tracking_number
        return (
          <div
            key={String(s.id ?? idx)}
            className="flex flex-col gap-y-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <Text size="small" weight="plus">
                {/* pickup_scheduled_date is date-only (YYYY-MM-DD) — no time part */}
                {getFullDate({ date: s.pickup_scheduled_date })}
              </Text>
              {s.pickup_location_name && (
                <Text size="xsmall" className="text-ui-fg-subtle">
                  {t("partner.workOrders.pickupFrom")}: {s.pickup_location_name}
                </Text>
              )}
              {awb &&
                (s.tracking_url ? (
                  <a
                    href={s.tracking_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-ui-fg-interactive hover:text-ui-fg-interactive-hover"
                  >
                    <Text size="xsmall">AWB {awb}</Text>
                  </a>
                ) : (
                  <Text size="xsmall">AWB {awb}</Text>
                ))}
            </div>
          </div>
        )
      })}
    </Container>
  )
}

/**
 * #888 — Per-shipment tracking timeline fed by the carrier webhook. Renders a
 * compact toggle; expanded shows events newest-first. Never renders
 * metadata.last_webhook (the raw carrier payload).
 */
const ShipmentTrackingHistory = ({
  shipment,
}: {
  shipment: Record<string, any>
}) => {
  const { t } = useTranslation()
  const { getFullDate } = useDate()
  const [open, setOpen] = useState(false)

  const events = (() => {
    const raw = shipment?.metadata?.tracking_events
    if (!raw || !Array.isArray(raw)) return [] as any[]
    return raw.slice(0, 50)
  })()

  if (events.length === 0) return null

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-ui-fg-interactive hover:text-ui-fg-interactive-hover"
      >
        <Text size="xsmall">
          {t("partner.workOrders.trackingHistory")} ({events.length})
        </Text>
      </button>
      {open && (
        <div className="mt-1 flex flex-col gap-y-0.5">
          {[...events].reverse().map((ev, i) => (
            <Text key={i} size="xsmall" className="text-ui-fg-subtle">
              {String(ev?.status || "")}
              {ev?.received_at
                ? ` · ${getFullDate({ date: ev.received_at, includeTime: true })}`
                : ""}
              {ev?.location ? ` · ${ev.location}` : ""}
            </Text>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Shipments section for an inventory work-order (#772 follow-up) — lists the
 * carrier shipments the partner generated (AWB · carrier · pickup · label),
 * reading the first-class shipment rows the detail endpoint now returns.
 */
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`

/**
 * Label + pickup for one shipment. The label is fetched fresh on tap (Delhivery's
 * PDF link lasts 24h); a shipment with no pickup yet can book one here.
 */
const ShipmentActions = ({ orderId, shipment }: { orderId: string; shipment: Record<string, any> }) => {
  const { t } = useTranslation()
  const label = useInventoryShipmentLabel(orderId)
  const book = useBookInventoryShipmentPickup(orderId)
  const [open, setOpen] = useState(false)
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
  const [date, setDate] = useState(ymd(tomorrow))
  const [time, setTime] = useState("14:00")
  const status = String(shipment.status || "").toLowerCase()
  if (!shipment.awb || status === "cancelled" || status === "booking_pending") return null
  const canBook = status === "created" || !shipment.pickup_scheduled_date

  const openLabel = async () => {
    try {
      const res = await label.mutateAsync(String(shipment.id))
      window.open(res.label_url, "_blank", "noopener")
    } catch (e: any) {
      toast.error(e?.message || t("partner.workOrders.labelUnavailable"))
    }
  }
  const submit = async () => {
    try {
      const res = await book.mutateAsync({ shipmentId: String(shipment.id), pickup_date: date, pickup_time: time })
      if (res.pickup.scheduled) {
        toast.success(t("partner.workOrders.pickupBooked", { date: res.pickup.pickup_date, time: res.pickup.pickup_time }))
        setOpen(false)
      } else {
        toast.error(t("partner.workOrders.pickupNotBooked", { reason: res.pickup.reason }))
      }
    } catch (e: any) {
      toast.error(e?.message)
    }
  }

  return (
    <div className="flex flex-col gap-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="small" variant="secondary" onClick={openLabel} isLoading={label.isPending}>
          {t("partner.workOrders.downloadLabel")}
        </Button>
        {canBook && !open && (
          <Button size="small" variant="secondary" onClick={() => setOpen(true)}>
            {t("partner.workOrders.bookPickup")}
          </Button>
        )}
      </div>
      {open && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-y-1">
            <Text size="xsmall" className="text-ui-fg-subtle">{t("partner.workOrders.pickupDate")}</Text>
            <DatePicker
              value={new Date(`${date}T00:00:00`)}
              onChange={(d) => d && setDate(ymd(d))}
            />
          </div>
          <div className="flex flex-col gap-y-1">
            <Text size="xsmall" className="text-ui-fg-subtle">{t("partner.workOrders.pickupTime")}</Text>
            <Input type="time" size="small" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
          <Button size="small" onClick={submit} isLoading={book.isPending}>
            {t("partner.workOrders.bookPickup")}
          </Button>
        </div>
      )}
    </div>
  )
}

export const InventoryShipmentsSection = ({
  shipments,
  orderId,
}: {
  shipments: Array<Record<string, any>>
  /** The inventory order id; enables the label and pickup actions. */
  orderId?: string
}) => {
  const { t } = useTranslation()
  const { getFullDate } = useDate()

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">{t("partner.workOrders.shipments")}</Heading>
      </div>
      {shipments.length === 0 ? (
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">
            {t("partner.workOrders.noShipments")}
          </Text>
        </div>
      ) : (
        shipments.map((s, idx) => {
          const awb = s.awb || s.tracking_number
          if (isBookingPending(s)) {
            const requestedAt =
              s?.metadata?.manual_booking?.requested_at || s.created_at
            const carrierName = carrierLabel(s.carrier) || carrierLabel("india_post")
            return (
              <div key={String(s.id ?? idx)} className="flex flex-col gap-y-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <Text size="small" weight="plus">
                    {carrierName}
                  </Text>
                  {requestedAt && (
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      {t("partner.workOrders.bookingRequestedOn", {
                        date: getFullDate({ date: requestedAt, includeTime: true }),
                      })}
                    </Text>
                  )}
                  <Text size="xsmall" className="text-ui-fg-subtle mt-1">
                    {t("partner.workOrders.bookingPendingNote", { carrier: carrierName })}
                  </Text>
                </div>
                <div className="flex items-center gap-x-3">
                  <StatusBadge color="orange" className="text-nowrap">
                    {t("partner.workOrders.bookingRequested")}
                  </StatusBadge>
                </div>
              </div>
            )
          }
          return (
            <div key={String(s.id ?? idx)} className="flex flex-col gap-y-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                {awb &&
                  (s.tracking_url ? (
                    <a
                      href={s.tracking_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-ui-fg-interactive hover:text-ui-fg-interactive-hover"
                    >
                      <Text size="small" weight="plus">
                        AWB {awb}
                      </Text>
                    </a>
                  ) : (
                    <Text size="small" weight="plus">
                      AWB {awb}
                    </Text>
                  ))}
                <Text size="xsmall" className="text-ui-fg-subtle">
                  {carrierLabel(s.carrier)}
                  {s.pickup_location_name
                    ? ` · ${t("partner.workOrders.pickupFrom")}: ${s.pickup_location_name}`
                    : ""}
                  {s.created_at
                    ? ` · ${getFullDate({ date: s.created_at, includeTime: true })}`
                    : ""}
                </Text>
                <ShipmentTrackingHistory shipment={s} />
                {orderId && (
                  <div className="mt-2">
                    <ShipmentActions orderId={orderId} shipment={s} />
                  </div>
                )}
              </div>
              <div className="flex items-center gap-x-3">
                {s.label_url && !orderId && (
                  <a
                    href={s.label_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-ui-fg-interactive hover:text-ui-fg-interactive-hover"
                  >
                    <Text size="xsmall">{t("partner.workOrders.trackingLabel")}</Text>
                  </a>
                )}
                {s.status && (
                  <StatusBadge
                    color={getStatusBadgeColor(String(s.status))}
                    className="text-nowrap"
                  >
                    {String(s.status).replace(/_/g, " ")}
                  </StatusBadge>
                )}
              </div>
            </div>
          )
        })
      )}
    </Container>
  )
}
