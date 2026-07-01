import { Container, Heading, Text, Badge } from "@medusajs/ui"
import { Link, useParams } from "react-router-dom"

import { getStylizedAmount } from "../../lib/money-amount-helpers"
import { WorkOrderLineCard, WorkOrderLineStat } from "./work-order-line-card"

const fmt = (n: number) => {
  if (!Number.isFinite(n)) {
    return "0"
  }
  const s = (Math.round(n * 1000) / 1000).toFixed(3)
  return s.replace(/\.0+$/, "").replace(/(\.[0-9]*?)0+$/, "$1")
}

/**
 * #826 S3b — the design line items of a COLLATED design work-order, rendered
 * one card per design (mirrors <InventoryOrderLines>). The collated work-order
 * carries one core line item per design (title = design name, metadata.design_id
 * / production_run_id), so a partner sees ONE order with many designs instead of
 * N separate design work-orders.
 */
export const DesignOrderLines = ({
  lines,
  currencyCode,
  totalPrice,
}: {
  lines: Array<Record<string, any>>
  currencyCode?: string
  totalPrice?: number | null
}) => {
  const { id: orderId } = useParams()

  if (!lines?.length) {
    return null
  }

  const cc = (currencyCode || "").toLowerCase()
  const money = (amount: number) =>
    cc ? getStylizedAmount(amount, cc) : fmt(amount)

  const totalQuantity = lines.reduce((sum, l) => sum + (Number(l?.quantity) || 0), 0)
  const computedTotal =
    totalPrice != null
      ? Number(totalPrice)
      : lines.reduce(
          (sum, l) => sum + (Number(l?.unit_price) || 0) * (Number(l?.quantity) || 0),
          0
        )

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center gap-x-3 px-6 py-4">
        <Heading level="h2">Designs</Heading>
        <Badge size="2xsmall" color="blue">
          {lines.length}
        </Badge>
      </div>

      <div className="px-6 py-4">
        {lines.map((line) => {
          const title = line?.title || line?.metadata?.design_id || line?.id
          const quantity = Number(line?.quantity) || 0
          const unit = Number(line?.unit_price ?? line?.unit_price_incl_tax) || 0
          // #826 — each card opens ITS OWN design's details (collated orders
          // carry the design id on the line metadata). Falls back to a plain
          // card when the design or order id is unknown.
          const designId = line?.metadata?.design_id as string | undefined
          const card = (
            <WorkOrderLineCard
              title={String(title)}
              subtitle={`Qty ${fmt(quantity)}`}
            >
              <WorkOrderLineStat label="Quantity" value={fmt(quantity)} />
              {unit > 0 && (
                <WorkOrderLineStat
                  label="Amount"
                  value={money(unit * quantity)}
                  emphasis
                />
              )}
            </WorkOrderLineCard>
          )
          return designId && orderId ? (
            <Link
              key={String(line.id)}
              to={`/orders/${orderId}/design-details/${designId}`}
              className="block outline-none focus-visible:shadow-borders-interactive-with-active rounded-xl"
            >
              {card}
            </Link>
          ) : (
            <div key={String(line.id)}>{card}</div>
          )
        })}
      </div>

      {/* Total footer — the retail order-summary money block. */}
      <div className="flex flex-col gap-y-2 px-6 py-4">
        <div className="text-ui-fg-subtle flex items-center justify-between">
          <Text size="small">Total designs</Text>
          <Text size="small">{fmt(totalQuantity)}</Text>
        </div>
        {computedTotal > 0 && (
          <div className="flex items-center justify-between">
            <Text size="small" weight="plus">
              Total
            </Text>
            <Text size="small" weight="plus">
              {money(computedTotal)}
            </Text>
          </div>
        )}
      </div>
    </Container>
  )
}
