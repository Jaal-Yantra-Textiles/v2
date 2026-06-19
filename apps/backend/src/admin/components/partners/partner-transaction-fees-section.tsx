import { Container, Heading, Text, Badge, StatusBadge } from "@medusajs/ui"
import { usePartnerFees, type AdminPartnerFee } from "../../hooks/api/partners-admin"

// #541 (parent #336): surface the partner transaction-fee (commission) ledger
// on the admin partner DETAIL page, consuming the Slice-4 read API
// (`GET /admin/partners/:id/fees`). Read-only — fees are accrued at order.placed
// and reversed on cancel by subscribers, never mutated here.

type PartnerTransactionFeesSectionProps = {
  partnerId: string
}

function formatMoney(amount: number | string | null | undefined, currency: string) {
  const n = Number(amount ?? 0)
  const safe = Number.isFinite(n) ? n : 0
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: (currency || "INR").toUpperCase(),
      maximumFractionDigits: 2,
    }).format(safe)
  } catch {
    // Unknown/invalid currency code → fall back to a plain number + raw code.
    return `${safe.toFixed(2)} ${(currency || "").toUpperCase()}`
  }
}

const STATUS_COLOR: Record<string, "green" | "orange" | "grey" | "red"> = {
  accrued: "orange",
  invoiced: "green",
  waived: "grey",
  reversed: "red",
}

export const PartnerTransactionFeesSection = ({
  partnerId,
}: PartnerTransactionFeesSectionProps) => {
  const { fees, summary, count, isPending } = usePartnerFees(partnerId, { limit: 10 })

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Transaction fees</Heading>
          <Text size="small" leading="compact" className="text-ui-fg-subtle">
            Platform commission accrued per order this partner fulfils.
          </Text>
        </div>
        {summary ? (
          <Badge size="small" color="grey">
            {summary.count} {summary.count === 1 ? "fee" : "fees"}
          </Badge>
        ) : null}
      </div>

      {isPending ? (
        <div className="px-6 py-4">
          <div className="bg-ui-bg-subtle h-5 w-40 animate-pulse rounded" />
          <div className="bg-ui-bg-subtle mt-3 h-4 w-full animate-pulse rounded" />
          <div className="bg-ui-bg-subtle mt-2 h-4 w-2/3 animate-pulse rounded" />
        </div>
      ) : !summary || summary.count === 0 ? (
        <div className="px-6 py-6">
          <Text size="small" className="text-ui-fg-subtle">
            No transaction fees accrued yet.
          </Text>
        </div>
      ) : (
        <>
          {/* Net-commission roll-up, per currency. */}
          <div className="px-6 py-4">
            <Text size="xsmall" weight="plus" className="text-ui-fg-muted mb-2 uppercase">
              Net commission
            </Text>
            <div className="flex flex-col gap-y-1">
              {Object.entries(summary.by_currency).map(([currency, b]) => (
                <div key={currency} className="flex items-center justify-between">
                  <Text size="small" className="text-ui-fg-subtle">
                    {currency.toUpperCase()}
                  </Text>
                  <Text size="small" weight="plus">
                    {formatMoney(b.net_amount, currency)}
                  </Text>
                </div>
              ))}
            </div>
          </div>

          {/* Most recent fees. */}
          <div className="px-6 py-4">
            <Text size="xsmall" weight="plus" className="text-ui-fg-muted mb-2 uppercase">
              Recent
            </Text>
            <div className="flex flex-col gap-y-2">
              {(fees ?? []).map((fee: AdminPartnerFee) => (
                <div key={fee.id} className="flex items-center justify-between gap-x-2">
                  <Text
                    size="small"
                    className="text-ui-fg-subtle truncate font-mono"
                    title={fee.order_id}
                  >
                    {fee.order_id}
                  </Text>
                  <div className="flex items-center gap-x-2">
                    <Text size="small" weight="plus" className="text-nowrap">
                      {formatMoney(fee.fee_amount, fee.currency_code)}
                    </Text>
                    <StatusBadge color={STATUS_COLOR[fee.status] ?? "grey"}>
                      {fee.status}
                    </StatusBadge>
                  </div>
                </div>
              ))}
            </div>
            {typeof count === "number" && count > (fees?.length ?? 0) ? (
              <Text size="xsmall" className="text-ui-fg-muted mt-3">
                Showing {fees?.length ?? 0} of {count}.
              </Text>
            ) : null}
          </div>
        </>
      )}
    </Container>
  )
}
