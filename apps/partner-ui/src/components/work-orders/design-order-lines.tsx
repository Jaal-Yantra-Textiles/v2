import { Badge, Container, Heading, Text } from "@medusajs/ui"

import { getStylizedAmount } from "../../lib/money-amount-helpers"

const fmt = (n: number) => {
  if (!Number.isFinite(n)) {
    return "0"
  }
  const s = (Math.round(n * 1000) / 1000).toFixed(3)
  return s.replace(/\.0+$/, "").replace(/(\.[0-9]*?)0+$/, "$1")
}

/**
 * #826 — the compact money summary for a COLLATED design work-order: the design
 * count + total. The per-design cards (specs + lifecycle) live in the Production
 * section below (<CollatedDesignRuns>), so this stays a slim order-level total
 * instead of duplicating the design list.
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
