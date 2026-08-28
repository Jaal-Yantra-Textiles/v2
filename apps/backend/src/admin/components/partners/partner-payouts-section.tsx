import { Badge, Container, Heading, StatusBadge, Text } from "@medusajs/ui"
import { Link } from "react-router-dom"

import { usePaymentSubmissions } from "../../hooks/api/payment-submissions"
import { describePaymentLine } from "../../lib/payment-line-source"
import {
  paymentSubmissionStatusColor,
  paymentSubmissionStatusLabel,
} from "../../lib/payment-submission-status"

/**
 * What we have paid this partner, and what we still owe (#1622).
 *
 * 🔴 Distinct from the `Payments` section above it, which lists
 * `internal_payments` — the money-movement records. Those exist only once a
 * payout is approved, and they say nothing about what the money was FOR. This
 * reads the submissions themselves, so a Pending claim is visible from the
 * moment the partner makes it, with the work each line covers named.
 *
 * The running totals answer the question the founder actually asks — "have we
 * settled with them" — which neither a list of payments nor a list of designs
 * could answer on its own.
 */
export const PartnerPayoutsSection = ({ partnerId }: { partnerId: string }) => {
  const { payment_submissions: submissions, isPending } = usePaymentSubmissions(
    { partner_id: partnerId, limit: 50 },
    { enabled: !!partnerId }
  ) as any

  const rows: any[] = submissions || []

  /**
   * ⚠️ Rejected is excluded from both totals, not just from `paid`. A rejected
   * claim never paid anyone and is not owed either — counting it as outstanding
   * would overstate what this partner is due.
   */
  const live = rows.filter((s) => s.status !== "Rejected")
  const sum = (list: any[]) =>
    list.reduce((acc, s) => acc + Number(s.total_amount ?? 0), 0)
  const paid = sum(live.filter((s) => s.status === "Paid"))
  const outstanding = sum(live.filter((s) => s.status !== "Paid"))
  const currency = (rows[0]?.currency || "inr").toUpperCase()

  const money = (amount: number) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount)

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-2">
          <Heading level="h2">Payouts</Heading>
          <Badge size="2xsmall" className="ml-2">
            {rows.length}
          </Badge>
        </div>
        {rows.length > 0 && (
          <Text size="small" className="text-ui-fg-subtle">
            {money(paid)} paid · {money(outstanding)} outstanding
          </Text>
        )}
      </div>

      {!isPending && rows.length === 0 && (
        <div className="px-6 py-8">
          <Text size="small" className="text-ui-fg-subtle text-center">
            This partner has never been billed.
          </Text>
        </div>
      )}

      {rows.length > 0 && (
        <div className="flex flex-col divide-y px-6">
          {rows.map((submission) => {
            const items: any[] = submission.items || []
            /**
             * What the payout covered, in the shared vocabulary — never a
             * per-screen guess. Repeated labels collapse, so seven runs on one
             * order read as "Production runs" once rather than seven times.
             */
            const labels = Array.from(
              new Set(items.map((item) => describePaymentLine(item).label))
            )

            return (
              <div
                key={submission.id}
                className="flex items-center justify-between py-3"
              >
                <div className="flex flex-col gap-y-1">
                  <div className="flex items-center gap-x-2">
                    <StatusBadge
                      color={paymentSubmissionStatusColor(submission.status)}
                    >
                      {paymentSubmissionStatusLabel(submission.status)}
                    </StatusBadge>
                    <Text size="small" className="text-ui-fg-subtle">
                      {labels.length ? labels.join(", ") : "No lines"}
                    </Text>
                  </div>
                  <Link
                    to={`/payment-submissions/${submission.id}`}
                    className="text-ui-fg-interactive font-mono text-xs hover:underline"
                  >
                    {submission.id}
                  </Link>
                </div>
                <div className="flex flex-col items-end">
                  <Text size="small" weight="plus">
                    {new Intl.NumberFormat("en-IN", {
                      style: "currency",
                      currency: (submission.currency || "inr").toUpperCase(),
                      maximumFractionDigits: 2,
                    }).format(Number(submission.total_amount ?? 0))}
                  </Text>
                  <Text size="xsmall" className="text-ui-fg-subtle">
                    {submission.submitted_at
                      ? new Date(submission.submitted_at).toLocaleDateString()
                      : "not submitted"}
                  </Text>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Container>
  )
}
