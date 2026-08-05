import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Container, Heading, Text, StatusBadge } from "@medusajs/ui"
import { DetailWidgetProps } from "@medusajs/framework/types"
import { useQuery } from "@tanstack/react-query"
import { sdk } from "../lib/config"

// #623 (follow-up to #336): show the platform commission accrued for THIS order
// on the admin order detail page. The partner detail page already shows the
// aggregate ledger (`/admin/partners/:id/fees`); this surfaces the single
// per-order fee from `/admin/orders/:id/partner-fee`. Retail orders (no fee)
// render nothing — no empty card.

type AdminOrder = { id: string }

type ShippingCharge = {
  amount: number
  currency_code: string
  carrier: string | null
  is_foreign_currency: boolean
}

type DescribedFee = {
  order_id: string
  status: string
  fee_basis: "percentage" | "flat"
  rate_label: string
  fee_amount: number
  order_total: number
  currency_code: string
  is_collectible: boolean
  /** Null when the partner shipped on their own carrier account. */
  shipping: ShippingCharge | null
  /** order_total − commission − platform shipping. */
  net_payout: number
}

type PartnerFeeResponse = {
  order_id: string
  fee: unknown | null
  display: DescribedFee | null
}

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

const OrderPartnerFeeWidget = ({ data: order }: DetailWidgetProps<AdminOrder>) => {
  const { data, isLoading } = useQuery({
    queryFn: () =>
      sdk.client.fetch<PartnerFeeResponse>(
        `/admin/orders/${order.id}/partner-fee`,
        { method: "GET" }
      ),
    queryKey: ["order-partner-fee", order.id],
  })

  // Retail order / never accrued → nothing to show.
  if (!isLoading && !data?.display) {
    return null
  }

  const fee = data?.display

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Partner payout</Heading>
          <Text size="small" leading="compact" className="text-ui-fg-subtle">
            What comes off this order before the partner is paid.
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
          {/* Platform shipping — present only when the partner generated the
              label on OUR carrier account rather than shipping themselves. A
              foreign-currency carrier charge is shown but never folded into
              net_payout (no FX rate is invented server-side). */}
          {fee.shipping && (
            <div className="flex items-center justify-between">
              <Text size="small" className="text-ui-fg-subtle">
                Platform shipping
                {fee.shipping.carrier ? ` (${fee.shipping.carrier})` : ""}
              </Text>
              <Text size="small" weight="plus">
                {formatMoney(fee.shipping.amount, fee.shipping.currency_code)}
                {fee.shipping.is_foreign_currency ? " *" : ""}
              </Text>
            </div>
          )}
          <div className="flex items-center justify-between">
            <Text size="small" className="text-ui-fg-subtle">
              Order total
            </Text>
            <Text size="small" className="text-ui-fg-subtle">
              {formatMoney(fee.order_total, fee.currency_code)}
            </Text>
          </div>
          <div className="flex items-center justify-between border-t border-dashed pt-3">
            <Text size="small" weight="plus">
              Partner receives
            </Text>
            <Text size="small" weight="plus">
              {formatMoney(fee.net_payout, fee.currency_code)}
            </Text>
          </div>
          {fee.shipping?.is_foreign_currency && (
            <Text size="xsmall" className="text-ui-fg-muted">
              * Shipping was charged in {fee.shipping.currency_code} and is
              settled separately, so it is not deducted above.
            </Text>
          )}
        </div>
      )}
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "order.details.side.after",
})

export default OrderPartnerFeeWidget
