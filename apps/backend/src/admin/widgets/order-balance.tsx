import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { DetailWidgetProps } from "@medusajs/framework/types"
import { Button, Container, Heading, StatusBadge, Text, toast } from "@medusajs/ui"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { sdk } from "../lib/config"

/**
 * The second half of a quote's money, on the order it belongs to (#1451).
 *
 * A quote is accepted with a deposit; the balance becomes payable when the
 * goods exist. Partners raise it themselves from the partner portal, and
 * dispatch raises it automatically — this is the admin's view of the same
 * thing, for an order no partner is working or when someone asks for it to be
 * done on their behalf.
 *
 * ⚠️ Renders NOTHING for an ordinary order. Most orders have no payment
 * schedule at all, and an empty card on every order detail page is noise.
 */
type AdminOrder = { id: string }

type BalanceState = {
  has_schedule: boolean
  order_id: string
  payment_schedule_id?: string
  currency_code?: string | null
  total_due?: number | null
  deposit_amount?: number | null
  deposit_status?: string | null
  balance_amount?: number | null
  balance_status?: string | null
  balance_link?: string | null
  can_raise?: boolean
  reason?: string | null
  code?: string | null
}

const money = (amount?: number | null, currency?: string | null) => {
  if (amount === null || amount === undefined || !currency) return "—"
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amount)
  } catch {
    return `${amount} ${currency.toUpperCase()}`
  }
}

/** Colour follows the money, not the mood: only actually-paid is green. */
const badgeFor = (status?: string | null) => {
  switch (status) {
    case "paid":
      return { color: "green" as const, label: "Paid" }
    case "due":
      return { color: "orange" as const, label: "Due" }
    case "waived":
      return { color: "grey" as const, label: "Waived" }
    case "failed":
      return { color: "red" as const, label: "Failed" }
    default:
      return { color: "grey" as const, label: "Not due yet" }
  }
}

const OrderBalanceWidget = ({ data }: DetailWidgetProps<AdminOrder>) => {
  const orderId = data?.id
  const queryClient = useQueryClient()

  const { data: balance, isLoading } = useQuery<BalanceState>({
    queryKey: ["order-balance", orderId],
    queryFn: async () =>
      (await sdk.client.fetch(`/admin/orders/${orderId}/balance`)) as BalanceState,
    enabled: Boolean(orderId),
  })

  const raise = useMutation({
    mutationFn: async () =>
      (await sdk.client.fetch(`/admin/orders/${orderId}/balance`, {
        method: "POST",
        body: { confirm: true },
      })) as BalanceState & { raised: boolean; pay_url: string | null },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["order-balance", orderId] })
      toast.success(
        res.raised
          ? `Balance raised — ${money(res.balance_amount, res.currency_code)} due`
          : "Nothing to raise",
        { description: res.reason ?? undefined }
      )
    },
    onError: (e: any) => {
      // The backend's refusals are written for a human; show them verbatim
      // rather than replacing them with "something went wrong".
      toast.error("Could not raise the balance", {
        description: e?.message ?? String(e),
      })
    },
  })

  // No schedule → an ordinary order. Render nothing at all.
  if (isLoading || !balance?.has_schedule) {
    return null
  }

  const badge = badgeFor(balance.balance_status)
  const isPaid = balance.balance_status === "paid"

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Balance</Heading>
        <StatusBadge color={badge.color}>{badge.label}</StatusBadge>
      </div>

      <div className="flex flex-col gap-y-2 px-6 py-4">
        <div className="flex items-center justify-between">
          <Text size="small" className="text-ui-fg-subtle">
            Deposit{balance.deposit_status === "paid" ? " (paid)" : ""}
          </Text>
          <Text size="small">
            {money(balance.deposit_amount, balance.currency_code)}
          </Text>
        </div>
        <div className="flex items-center justify-between">
          <Text size="small" className="text-ui-fg-subtle">
            Balance
          </Text>
          <Text size="small" weight="plus">
            {money(balance.balance_amount, balance.currency_code)}
          </Text>
        </div>
        <div className="flex items-center justify-between border-t border-dashed pt-2">
          <Text size="small" className="text-ui-fg-subtle">
            Order total
          </Text>
          <Text size="small">{money(balance.total_due, balance.currency_code)}</Text>
        </div>
      </div>

      <div className="flex flex-col gap-y-3 px-6 py-4">
        {/* The reason is the backend's, verbatim. It is the only place an
            operator learns WHY a balance cannot be raised — an unpaid deposit,
            an amount that disagrees with the order, a balance already paid. */}
        {balance.reason && !isPaid && (
          <Text size="small" className="text-ui-fg-subtle">
            {balance.reason}
          </Text>
        )}

        {balance.balance_link && (
          <div className="flex flex-col gap-y-1">
            <Text size="xsmall" className="text-ui-fg-muted">
              Buyer's payment link
            </Text>
            {/* Selectable rather than a button: an operator pastes this into
                their own message to the buyer as often as they click it. */}
            <Text size="xsmall" className="break-all font-mono">
              {balance.balance_link}
            </Text>
          </div>
        )}

        {!isPaid && (
          <Button
            size="small"
            variant="secondary"
            disabled={!balance.can_raise || raise.isPending}
            isLoading={raise.isPending}
            onClick={() => raise.mutate()}
          >
            {balance.balance_status === "due"
              ? "Re-issue the payment link"
              : "Raise the balance"}
          </Button>
        )}

        {balance.balance_status === "not_due" && balance.can_raise && (
          <Text size="xsmall" className="text-ui-fg-muted">
            Dispatching this order raises the balance automatically. Use this
            only when the goods are ready and no shipment has been recorded yet.
          </Text>
        )}
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "order.details.side.after",
})

export default OrderBalanceWidget
