import { Container, Heading, StatusBadge, Text } from "@medusajs/ui"
import { useTranslation } from "react-i18next"

import { useDate } from "../../hooks/use-date"
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
          <div key={e.id} className="flex items-center justify-between px-6 py-4">
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
          <div key={String(p.id ?? idx)} className="flex items-center justify-between px-6 py-4">
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
 * Shipments section for an inventory work-order (#772 follow-up) — lists the
 * carrier shipments the partner generated (AWB · carrier · pickup · label),
 * reading the first-class shipment rows the detail endpoint now returns.
 */
export const InventoryShipmentsSection = ({
  shipments,
}: {
  shipments: Array<Record<string, any>>
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
          return (
            <div key={String(s.id ?? idx)} className="flex items-center justify-between px-6 py-4">
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
                <Text size="xsmall" className="text-ui-fg-subtle capitalize">
                  {String(s.carrier || "")}
                  {s.pickup_location_name
                    ? ` · ${t("partner.workOrders.pickupFrom")}: ${s.pickup_location_name}`
                    : ""}
                  {s.created_at
                    ? ` · ${getFullDate({ date: s.created_at, includeTime: true })}`
                    : ""}
                </Text>
              </div>
              <div className="flex items-center gap-x-3">
                {s.label_url && (
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
