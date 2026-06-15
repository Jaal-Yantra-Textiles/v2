import { Container, Heading, Text } from "@medusajs/ui"
import { useTranslation } from "react-i18next"

import { getStylizedAmount } from "../../lib/money-amount-helpers"
import { WorkOrderLineCard, WorkOrderLineStat } from "./work-order-line-card"

const fmt = (n: number) => {
  if (!Number.isFinite(n)) {
    return "0"
  }
  const s = (Math.round(n * 1000) / 1000).toFixed(3)
  return s.replace(/\.0+$/, "").replace(/(\.[0-9]*?)0+$/, "$1")
}

const lineFulfilled = (line: Record<string, any>): number =>
  Array.isArray(line?.line_fulfillments)
    ? line.line_fulfillments.reduce(
        (sum: number, f: any) => sum + (Number(f?.quantity_delta) || 0),
        0
      )
    : 0

/**
 * The requested / fulfilled / remaining line items for an inventory work-order
 * (#342), rendered in the retail order-summary aesthetic: per-line cards
 * (`WorkOrderLineCard`) with a cost-breakdown + bold Total footer — so a
 * work-order reads like a normal order.
 */
export const InventoryOrderLines = ({
  orderLines,
  currencyCode,
  totalPrice,
}: {
  orderLines: Array<Record<string, any>>
  currencyCode?: string
  totalPrice?: number | null
}) => {
  const { t } = useTranslation()

  if (!orderLines.length) {
    return (
      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading level="h2">{t("partner.inventoryOrders.detail.linesHeading")}</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            {t("partner.inventoryOrders.detail.noLines")}
          </Text>
        </div>
      </Container>
    )
  }

  const totalRequested = orderLines.reduce(
    (sum, l) => sum + (Number(l?.quantity) || 0),
    0
  )
  const cc = (currencyCode || "").toLowerCase()
  const money = (amount: number) =>
    cc ? getStylizedAmount(amount, cc) : fmt(amount)

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">{t("partner.inventoryOrders.detail.linesHeading")}</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          {t("partner.inventoryOrders.detail.linesDescription")}
        </Text>
      </div>

      <div className="px-6 py-4">
        {orderLines.map((line) => {
          const title =
            line?.inventory_items?.[0]?.title ||
            line?.inventory_items?.[0]?.name ||
            line?.inventory_item_id ||
            line?.id
          const sku = line?.inventory_items?.[0]?.sku
          const thumbnail = line?.inventory_items?.[0]?.thumbnail
          const requested = Number(line?.quantity) || 0
          const fulfilled = lineFulfilled(line)
          const remaining = Math.max(0, requested - fulfilled)
          const price = Number(line?.price) || 0

          return (
            <WorkOrderLineCard
              key={String(line.id)}
              title={String(title)}
              subtitle={sku ? `SKU ${sku}` : `${t("partner.inventoryOrders.detail.linePrefix")}: ${line.id}`}
              thumbnail={thumbnail}
            >
              <WorkOrderLineStat label={t("partner.inventoryOrders.detail.columns.requested")} value={fmt(requested)} />
              <WorkOrderLineStat label={t("partner.inventoryOrders.detail.columns.fulfilled")} value={fmt(fulfilled)} />
              <WorkOrderLineStat label={t("partner.inventoryOrders.detail.columns.remaining")} value={fmt(remaining)} emphasis />
              {price > 0 && (
                <WorkOrderLineStat label={t("partner.workOrders.amount")} value={money(price * requested)} emphasis />
              )}
            </WorkOrderLineCard>
          )
        })}
      </div>

      {/* Total footer — the retail order-summary money block */}
      <div className="flex flex-col gap-y-2 px-6 py-4">
        <div className="text-ui-fg-subtle flex items-center justify-between">
          <Text size="small">{t("partner.workOrders.totalQuantity")}</Text>
          <Text size="small">{fmt(totalRequested)}</Text>
        </div>
        {totalPrice != null && (
          <div className="flex items-center justify-between">
            <Text size="small" weight="plus">
              {t("partner.workOrders.total")}
            </Text>
            <Text size="small" weight="plus">
              {money(Number(totalPrice))}
            </Text>
          </div>
        )}
      </div>
    </Container>
  )
}
