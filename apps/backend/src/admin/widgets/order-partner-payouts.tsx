import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Container, Heading, StatusBadge, Text } from "@medusajs/ui"
import { DetailWidgetProps } from "@medusajs/framework/types"
import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"

import { sdk } from "../lib/config"
import { describePaymentLine } from "../lib/payment-line-source"
import {
  paymentSubmissionStatusColor,
  paymentSubmissionStatusLabel,
} from "../lib/payment-submission-status"
import { PaymentLineLinks, RefLink } from "../components/payments/payment-line-links"

/**
 * What this order cost us in partner labour (#1622).
 *
 * 🔴 The runs behind an order are linked to it; the payout for those runs was
 * not. Order #79 is seven production runs and one ₹8,974 payout, and standing
 * on the order there was no way to see the second half of that.
 *
 * Renders nothing when no payout names this order — an order with no partner
 * work behind it should not carry an empty card.
 */

type AdminOrder = { id: string }

type OrderPayout = {
  line_id: string
  submission_id: string
  submission_status: string | null
  partner_id: string | null
  partner?: { id: string; name: string } | null
  amount: number
  currency: string | null
  source_type: string | null
  design_id: string | null
  design_name: string | null
  task_id: string | null
  task_name: string | null
  inventory_order_id: string | null
  inventory_order_name: string | null
  order_id: string | null
  production_run_ids: string[] | null
  runs?: Array<{ id: string; name: string; detail?: string | null }>
}

type Response = {
  payouts: OrderPayout[]
  totals: { billed: number; paid: number }
  count: number
}

const money = (amount: number | null | undefined, currency?: string | null) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: (currency || "inr").toUpperCase(),
    maximumFractionDigits: 2,
  }).format(Number(amount ?? 0))

const OrderPartnerPayoutsWidget = ({ data }: DetailWidgetProps<AdminOrder>) => {
  const { data: result } = useQuery({
    queryKey: ["orders", data.id, "partner-payouts"],
    queryFn: async () =>
      sdk.client.fetch<Response>(
        `/admin/orders/${data.id}/partner-payouts`,
        { method: "GET" }
      ),
    enabled: !!data.id,
  })

  const payouts = result?.payouts || []
  if (!payouts.length) return null

  const currency = payouts[0]?.currency

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Partner payouts</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          {money(result?.totals?.paid, currency)} paid of{" "}
          {money(result?.totals?.billed, currency)} billed
        </Text>
      </div>
      <div className="flex flex-col divide-y px-6">
        {payouts.map((payout) => {
          const source = describePaymentLine(payout)

          return (
            <div key={payout.line_id} className="flex flex-col gap-y-2 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-x-2">
                  <StatusBadge
                    color={paymentSubmissionStatusColor(payout.submission_status)}
                  >
                    {paymentSubmissionStatusLabel(payout.submission_status)}
                  </StatusBadge>
                  <Text size="small">{source.label}</Text>
                  {payout.partner_id && (
                    <RefLink
                      kind="partner"
                      refOrId={payout.partner || payout.partner_id}
                      className="text-ui-fg-interactive text-xs hover:underline"
                    />
                  )}
                </div>
                <Text size="small" weight="plus">
                  {money(payout.amount, payout.currency)}
                </Text>
              </div>
              <PaymentLineLinks item={payout} />
              <Link
                to={`/payment-submissions/${payout.submission_id}`}
                className="text-ui-fg-interactive font-mono text-xs hover:underline"
              >
                {payout.submission_id}
              </Link>
            </div>
          )
        })}
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "order.details.after",
})

export default OrderPartnerPayoutsWidget
