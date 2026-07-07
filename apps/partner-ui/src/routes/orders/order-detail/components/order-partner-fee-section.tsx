import { Container, Heading, StatusBadge, Text } from "@medusajs/ui"

import { usePartnerOrderFee } from "../../../../hooks/api/partner-order-fee"

// #623 (follow-up to #336): show the platform commission deducted on THIS order
// in the partner's own order view — parity with the admin order-detail widget.
// Renders nothing for a retail order / one that never accrued a fee.

const STATUS_COLOR: Record<string, "green" | "orange" | "grey" | "red"> = {
  accrued: "orange",
  invoiced: "green",
  waived: "grey",
  reversed: "red",
}

function formatMoney(amount: number, currency: string) {
  const safe = Number.isFinite(amount) ? amount : 0
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: (currency || "INR").toUpperCase(),
      maximumFractionDigits: 2,
    }).format(safe)
  } catch {
    return `${safe.toFixed(2)} ${(currency || "").toUpperCase()}`
  }
}

type OrderPartnerFeeSectionProps = {
  orderId: string
}

export const OrderPartnerFeeSection = ({
  orderId,
}: OrderPartnerFeeSectionProps) => {
  const { data, isLoading } = usePartnerOrderFee(orderId)
  const fee = data?.display

  // No fee for this order (retail / never accrued) → no card.
  if (!isLoading && !fee) {
    return null
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-y-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Heading level="h2">Platform commission</Heading>
          <Text size="small" leading="compact" className="text-ui-fg-subtle">
            The platform's cut on this order, deducted from your payout.
          </Text>
        </div>
        {fee ? (
          <StatusBadge color={STATUS_COLOR[fee.status] ?? "grey"}>
            {fee.status}
          </StatusBadge>
        ) : null}
      </div>

      {isLoading || !fee ? (
        <div className="px-6 py-4">
          <div className="bg-ui-bg-subtle h-4 w-32 animate-pulse rounded" />
          <div className="bg-ui-bg-subtle mt-2 h-4 w-24 animate-pulse rounded" />
        </div>
      ) : (
        <div className="flex flex-col gap-y-3 px-6 py-4">
          <div className="flex items-center justify-between">
            <Text size="small" className="text-ui-fg-subtle">
              Rate
            </Text>
            <Text size="small" weight="plus">
              {fee.rate_label}
            </Text>
          </div>
          <div className="flex items-center justify-between">
            <Text size="small" className="text-ui-fg-subtle">
              Commission
            </Text>
            <Text size="small" weight="plus">
              {formatMoney(fee.fee_amount, fee.currency_code)}
            </Text>
          </div>
          <div className="flex items-center justify-between">
            <Text size="small" className="text-ui-fg-subtle">
              Order total
            </Text>
            <Text size="small" className="text-ui-fg-subtle">
              {formatMoney(fee.order_total, fee.currency_code)}
            </Text>
          </div>
        </div>
      )}
    </Container>
  )
}
