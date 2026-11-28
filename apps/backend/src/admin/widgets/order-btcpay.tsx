import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { DetailWidgetProps } from "@medusajs/framework/types"
import { Badge, Button, Container, Heading, Input, Text, toast } from "@medusajs/ui"
import { useQuery } from "@tanstack/react-query"

import { sdk } from "../lib/config"

/**
 * Bitcoin (BTCPay) on the order page: the invoice as BTCPay sees it and every
 * refund's claim link with where its payout stands.
 *
 * A Bitcoin refund is a BTCPay "pull payment": nothing is sent until the buyer
 * opens the claim link and gives an address, and then someone approves and
 * pays the payout in BTCPay. The widget says which of those steps is next.
 * Refunds are made with Medusa's own Refund on the Payment section (it calls
 * the BTCPay provider's refundPayment), so there is one way to refund and the
 * order's totals and refund records stay Medusa's. This widget only shows
 * what that refund produced. Place it under Payment with the page's Customize
 * menu (layout composer, 2.22) — widgets with no saved position render first.
 */
type AdminOrder = {
  id: string
  payment_collections?: { payments?: { refunds?: { id: string }[] | null }[] | null }[] | null
}

type Payout = { id: string; state: string; btc?: string | null; destination?: string }
type Refund = {
  pull_payment_id: string
  link?: string
  amount?: string
  currency?: string
  created_at?: string
  payouts: Payout[] | null
  error?: string
}
type BtcpayPayment = {
  payment_id: string
  amount: number
  currency_code: string
  refunded_in_medusa: number
  invoice: {
    id?: string
    link?: string | null
    status?: string
    additional_status?: string
    amount?: string
    currency?: string
    partner_id?: string | null
    error?: string
  }
  refunds: Refund[]
  btcpay_payouts_url: string | null
}
type Resp = { btcpay: boolean; configured?: boolean; payments: BtcpayPayment[] }

const money = (amount: number | string | undefined, currency: string | undefined) => {
  const n = Number(amount ?? 0)
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: String(currency || "INR").toUpperCase() }).format(n)
  } catch {
    return `${n.toFixed(2)} ${String(currency || "").toUpperCase()}`
  }
}

const invoiceBadge = (status?: string, extra?: string) => {
  if (!status) return <Badge size="2xsmall">Unknown</Badge>
  const label = extra && extra !== "None" ? `${status} · ${extra}` : status
  const color = status === "Settled" ? "green" : status === "Processing" || status === "New" ? "orange" : "red"
  return <Badge size="2xsmall" color={color as any}>{label}</Badge>
}

/** What the next step for a refund is, in plain words. */
const refundStep = (r: Refund): { label: string; color: "grey" | "orange" | "blue" | "green" | "red"; next?: string } => {
  if (r.payouts === null) return { label: "Status unavailable", color: "grey", next: r.error }
  const live = r.payouts.filter((p) => p.state !== "Cancelled")
  if (!live.length) return { label: "Waiting for the buyer to claim", color: "orange", next: "Send the buyer the claim link." }
  const s = live[live.length - 1].state
  if (s === "AwaitingApproval") return { label: "Buyer claimed", color: "blue", next: "Approve and pay the payout in BTCPay." }
  if (s === "AwaitingPayment") return { label: "Approved, not sent", color: "blue", next: "Send the payout from the BTCPay wallet." }
  if (s === "InProgress") return { label: "Sent, confirming", color: "blue" }
  if (s === "Completed") return { label: "Refunded", color: "green" }
  return { label: s, color: "grey" }
}

const OrderBtcpayWidget = ({ data: order }: DetailWidgetProps<AdminOrder>) => {
  // Medusa's own Refund refetches the order, not this widget's query: keying on
  // the order's refund ids makes a new refund show up without a page refresh.
  const refundIds = (order.payment_collections ?? [])
    .flatMap((pc) => pc?.payments ?? [])
    .flatMap((p) => p?.refunds ?? [])
    .map((r) => r.id)
    .sort()
    .join(",")
  const queryKey = ["order-btcpay", order.id, refundIds]

  const { data, isPending, isError, error } = useQuery({
    queryKey,
    // Payout state changes in BTCPay, not here (buyer claims, someone pays).
    refetchOnWindowFocus: true,
    queryFn: () => sdk.client.fetch<Resp>(`/admin/btcpay/orders/${order.id}`, { method: "GET" }),
  })

  if (isPending) {
    return (
      <Container className="px-6 py-4">
        <Text size="small" className="text-ui-fg-subtle">Loading Bitcoin payment…</Text>
      </Container>
    )
  }
  if (isError) {
    return (
      <Container className="px-6 py-4">
        <Text size="small" className="text-ui-fg-error">Could not load the Bitcoin payment: {(error as any)?.message}</Text>
      </Container>
    )
  }
  if (!data?.btcpay) return null

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success("Claim link copied")
    } catch {
      toast.error("Could not copy — select the link and copy it")
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Bitcoin (BTCPay)</Heading>
        {!data.configured ? <Badge size="2xsmall" color="red">BTCPay not configured</Badge> : null}
      </div>

      {data.payments.map((p) => {
        return (
          <div key={p.payment_id} className="flex flex-col gap-y-4 px-6 py-4">
            <div className="flex items-start justify-between gap-x-4">
              <div className="flex flex-col gap-y-1">
                <Text size="small" leading="compact" weight="plus">
                  Invoice {p.invoice.id}
                </Text>
                <Text size="small" leading="compact" className="text-ui-fg-subtle">
                  {money(p.amount, p.currency_code)} paid
                  {p.refunded_in_medusa > 0 ? ` · ${money(p.refunded_in_medusa, p.currency_code)} refunded` : ""}
                  {p.invoice.partner_id ? ` · partner store` : ""}
                </Text>
                {p.invoice.error ? (
                  <Text size="xsmall" className="text-ui-fg-error">{p.invoice.error}</Text>
                ) : null}
              </div>
              <div className="flex items-center gap-x-2">
                {invoiceBadge(p.invoice.status, p.invoice.additional_status)}
                {p.invoice.link ? (
                  <Button size="small" variant="secondary" onClick={() => window.open(p.invoice.link!, "_blank")}>
                    Open in BTCPay
                  </Button>
                ) : null}
              </div>
            </div>

            {p.refunds.length === 0 ? (
              <Text size="small" className="text-ui-fg-subtle">
                To refund, use Refund on this payment in the Payment section. A claim link for the buyer appears here.
              </Text>
            ) : null}

            {p.refunds.length ? (
              <div className="flex flex-col gap-y-3">
                {p.refunds.map((r) => {
                  const step = refundStep(r)
                  return (
                    <div key={r.pull_payment_id} className="flex flex-col gap-y-2 rounded-lg border border-ui-border-base p-3">
                      <div className="flex items-center justify-between gap-x-2">
                        <Text size="small" leading="compact" weight="plus">
                          Refund {money(r.amount, r.currency || p.currency_code)}
                          {r.created_at ? (
                            <span className="text-ui-fg-subtle font-normal"> · {new Date(r.created_at).toLocaleString("en-IN")}</span>
                          ) : null}
                        </Text>
                        <Badge size="2xsmall" color={step.color}>{step.label}</Badge>
                      </div>
                      {(() => {
                        const live = (r.payouts ?? []).filter((x) => x.state !== "Cancelled")
                        const last = live[live.length - 1]
                        return last ? (
                          <Text size="xsmall" className="text-ui-fg-subtle">
                            {last.btc ? `${last.btc} BTC` : "BTC amount set when paid"}
                            {last.destination ? ` to ${last.destination.slice(0, 10)}…${last.destination.slice(-6)}` : ""}
                          </Text>
                        ) : null
                      })()}
                      {step.next ? (
                        <Text size="xsmall" className="text-ui-fg-subtle">Next: {step.next}</Text>
                      ) : null}
                      {r.link ? (
                        <div className="flex items-center gap-x-2">
                          <Input size="small" readOnly value={r.link} onFocus={(e) => e.currentTarget.select()} />
                          <Button size="small" variant="secondary" onClick={() => copy(r.link!)}>Copy link</Button>
                        </div>
                      ) : null}
                    </div>
                  )
                })}
                {p.btcpay_payouts_url ? (
                  <div>
                    <Button size="small" variant="transparent" onClick={() => window.open(p.btcpay_payouts_url!, "_blank")}>
                      Approve and pay payouts in BTCPay →
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        )
      })}
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "order.details.after",
})

export default OrderBtcpayWidget
