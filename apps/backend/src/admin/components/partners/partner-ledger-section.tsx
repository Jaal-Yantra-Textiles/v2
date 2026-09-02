import { Badge, Container, Heading, StatusBadge, Text, toast } from "@medusajs/ui"
import { Check, DocumentText, Plus } from "@medusajs/icons"
import { useState } from "react"
import { Link } from "react-router-dom"

import { ActionMenu } from "../common/action-menu"
import {
  usePartnerLedger,
  useSetPaymentSettles,
  useUpdatePayment,
  type PartnerLedgerEntry,
} from "../../hooks/api/payments"
import { describePaymentLine } from "../../lib/payment-line-source"
import {
  paymentSubmissionStatusColor,
  paymentSubmissionStatusLabel,
  payoutSettlementBadge,
} from "../../lib/payment-submission-status"

/**
 * What we owe this partner and what we have paid them — BOTH records, one list
 * (#1612).
 *
 * 🔴 This replaces two adjacent panels. `Payments` read `internal_payments` and
 * `Payouts` read the submissions, and since #1638 those are no longer two views
 * of the same thing: approval writes no payment row, so every payout since is
 * invisible to the first panel while the 31 historical rows are invisible to
 * the second. Two panels each showing half the money is how a reader concludes
 * they have seen all of it (#1621).
 *
 * The historical rows are NOT migrated — they stay as they are (founder's
 * call). Every entry says which record it came from, because the two mean
 * different things: a payout is a claim with lines behind it, a payment is a
 * movement of money with no statement of what it was for.
 */

const money = (amount: number | null | undefined, currency?: string | null) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: (currency || "inr").toUpperCase(),
    maximumFractionDigits: 2,
  }).format(Number(amount ?? 0))

const day = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString() : null

/**
 * "This payment settles this payout" — one click, no picker (#1710).
 *
 * ⚠️ Deliberately NOT a free-form link builder. The only payments offered are
 * the ones already sitting against an order this payout bills, which is the
 * only case where the answer is likely to be yes. Anything else is a judgement
 * that wants more context than a button.
 */
const SettlesButton = ({
  paymentId,
  submissionId,
  amount,
  currency,
}: {
  paymentId: string
  submissionId: string
  amount: number
  currency: string
}) => {
  const { mutateAsync, isPending } = useSetPaymentSettles(paymentId)

  return (
    <button
      type="button"
      disabled={isPending}
      data-testid={`settles-${paymentId}`}
      className="text-ui-fg-interactive txt-compact-xsmall w-fit hover:underline disabled:opacity-50"
      onClick={() => {
        void (async () => {
          try {
            await mutateAsync({
              payment_submission_id: submissionId,
              settles: true,
            })
            toast.success(
              `${money(amount, currency)} now counts against this payout`
            )
          } catch (e: any) {
            toast.error(e?.message || "Could not link this payment")
          }
        })()
      }}
    >
      Mark {money(amount, currency)} as settling this payout
    </button>
  )
}

/** A payout: a submission, with the work it bills named. */
const PayoutRow = ({ entry }: { entry: PartnerLedgerEntry }) => {
  /**
   * The shared vocabulary, never a per-screen guess. Repeated labels collapse,
   * so seven runs on one order read as "Production runs" once.
   */
  const labels = Array.from(
    new Set((entry.lines || []).map((line) => describePaymentLine(line).label))
  )

  const settlement = payoutSettlementBadge(entry)

  return (
    <div className="flex items-start justify-between py-3">
      <div className="flex flex-col gap-y-1">
        <div className="flex items-center gap-x-2">
          <StatusBadge color={paymentSubmissionStatusColor(entry.status)}>
            {paymentSubmissionStatusLabel(entry.status)}
          </StatusBadge>
          {settlement && (
            /**
             * 🔴 The money, said next to the approval state (#1712). Without
             * this a fully-settled payout renders a bare "Pending" directly
             * above a footer reading "paid", and the row reads as a
             * double-count to anyone who trusts the badge.
             */
            <StatusBadge color={settlement.color}>
              {settlement.label}
            </StatusBadge>
          )}
          <Text size="small" className="text-ui-fg-subtle">
            {labels.length ? labels.join(", ") : "No lines"}
          </Text>
        </div>
        <Link
          to={`/payment-submissions/${entry.submission_id}`}
          className="text-ui-fg-interactive font-mono text-xs hover:underline"
        >
          {entry.submission_id}
        </Link>
        {entry.settled_by && (
          /**
           * The historical payment row this payout was settled by. Shown here
           * rather than as its own entry — the same money listed twice would
           * double every total on this panel.
           */
          <Text size="xsmall" className="text-ui-fg-muted">
            settled by {entry.settled_by.payment_type || "payment"}
            {entry.settled_by.payment_date
              ? ` on ${day(entry.settled_by.payment_date)}`
              : ""}
          </Text>
        )}
        {(entry.credited_amount ?? 0) > 0 && (
          /**
           * 🔴 An applied credit HAS already reduced `outstanding` (#1712).
           * Unlike the warning below it is not advisory, which is exactly why
           * it must be on the row: without it the footer shows a smaller
           * amount owed than the payouts above add up to, and nothing on
           * screen explains the difference.
           */
          <Text size="xsmall" className="text-ui-tag-green-text">
            {money(entry.credited_amount!, entry.currency)} discharged by{" "}
            {entry.credits_applied!.length === 1
              ? entry.credits_applied![0].reason || "a credit"
              : `${entry.credits_applied!.length} credits`}
          </Text>
        )}
        {entry.status !== "Paid" && (entry.recorded_against_total ?? 0) > 0 && (
          /**
           * 🔴 #1710 — the line that stops someone being paid twice.
           *
           * This payout claims money is owed; these payments say money has
           * already moved against the same order. Neither record knows about
           * the other, so the reconciliation has to happen in the reader's
           * head — and it can only happen if the reader is TOLD.
           *
           * ⚠️ Not subtracted from the amount beside it. An advance and a
           * payout can legitimately coexist; only a human linking the payment
           * to this submission settles that question.
           */
          <div className="flex flex-col gap-y-1">
            <Text size="xsmall" className="text-ui-tag-orange-text">
              ⚠ {money(entry.recorded_against_total!, entry.currency)} already
              recorded against{" "}
              {entry.recorded_against!.length === 1
                ? entry.recorded_against![0].inventory_order_name ||
                  "the order this bills"
                : `${entry.recorded_against!.length} payments on the order this bills`}{" "}
              — check before paying
            </Text>
            {/**
             * 🔑 The action beside the warning (#1710).
             *
             * A warning with no way to act on it leaves the operator to go and
             * do something elsewhere, which mostly means nothing happens — the
             * warning becomes wallpaper. One click per payment turns "money is
             * sitting here" into "this money settles this payout", which is
             * the human statement the ledger refuses to infer.
             */}
            {entry.recorded_against!.map((r) => (
              <SettlesButton
                key={r.payment_id}
                paymentId={r.payment_id}
                submissionId={entry.submission_id!}
                amount={r.amount}
                currency={entry.currency}
              />
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-col items-end">
        <Text size="small" weight="plus">
          {money(entry.amount, entry.currency)}
        </Text>
        <Text size="xsmall" className="text-ui-fg-subtle">
          {entry.paid_at
            ? `paid ${day(entry.paid_at)}`
            : entry.submitted_at
              ? `claimed ${day(entry.submitted_at)}`
              : "not submitted"}
        </Text>
      </div>
    </div>
  )
}

/** A payment: an `internal_payments` row, with no statement of what it paid for. */
const PaymentRow = ({ entry }: { entry: PartnerLedgerEntry }) => {
  const paymentId = String(entry.id).replace(/^payment:/, "")
  const { mutateAsync, isPending } = useUpdatePayment(paymentId)
  const [loading, setLoading] = useState(false)

  const isCompleted = entry.status === "Completed"

  const handleClick = () => {
    if (isCompleted || loading || isPending) return
    void (async () => {
      try {
        setLoading(true)
        await mutateAsync({ status: "Completed" })
        toast.success("Payment marked as Completed")
      } catch (e: any) {
        toast.error(e?.message || "Failed to update payment")
      } finally {
        setLoading(false)
      }
    })()
  }

  const attachments = entry.attachments || []

  return (
    <div className="flex flex-col gap-y-2 py-3">
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-y-1">
          <div className="flex items-center gap-x-2">
            <Badge size="2xsmall">{entry.status || "Unknown"}</Badge>
            <Text size="small" className="text-ui-fg-subtle">
              {entry.payment_type || "Payment"}
            </Text>
          </div>
          {/* No lines exist for these. Saying so beats an empty space that
              reads as "nothing was billed". */}
          <Text size="xsmall" className="text-ui-fg-muted">
            {entry.inventory_order_id
              ? /* #1710 — this row reached the ledger through the ORDER link.
                   Before, it reached it through nothing at all and the panel
                   reported the partner as owed the full amount. */
                `recorded against ${entry.inventory_order_name || "an inventory order"} — no payout attached`
              : "recorded payment — no payout attached"}
          </Text>
        </div>
        <div className="flex items-center gap-x-3">
          <div className="flex flex-col items-end">
            <Text size="small" weight="plus">
              {money(entry.amount, entry.currency)}
            </Text>
            <Text size="xsmall" className="text-ui-fg-subtle">
              {day(entry.payment_date) || "no date"}
            </Text>
          </div>
          <ActionMenu
            groups={[
              {
                actions: [
                  {
                    label: isCompleted ? "Already Completed" : "Mark as Completed",
                    icon: <Check />,
                    onClick: handleClick,
                    disabled: isCompleted || loading || isPending,
                  },
                ],
              },
            ]}
          />
        </div>
      </div>
      {attachments.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 pl-1">
          {attachments.map((a: any) => (
            <a
              key={a.id || a.file_id}
              href={a.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-x-1 rounded-md border border-ui-border-base bg-ui-bg-subtle px-2 py-1 text-ui-fg-subtle transition-colors hover:bg-ui-bg-base hover:text-ui-fg-base"
            >
              <DocumentText className="text-ui-fg-muted" />
              <Text size="xsmall" className="max-w-[180px] truncate">
                {a.filename || a.file_id || "attachment"}
              </Text>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

export const PartnerLedgerSection = ({ partnerId }: { partnerId: string }) => {
  const { entries, totals, isLoading, isError } = usePartnerLedger(partnerId, {
    enabled: !!partnerId,
  })

  const rows: PartnerLedgerEntry[] = entries || []

  /**
   * ⚠️ Only rendered when every entry agrees on a currency. A single figure
   * over rupees plus euros is a wrong number, not a rounded one.
   */
  const showTotals = !!totals?.currency && rows.length > 0

  return (
    <Container className="divide-y p-0" data-partner-id={partnerId}>
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-2">
          <Heading level="h2">Payments</Heading>
          <Badge size="2xsmall" className="ml-2">
            {rows.length}
          </Badge>
        </div>
        <div className="flex items-center gap-x-4">
          <ActionMenu
            groups={[
              {
                actions: [
                  { label: "Add Payment", icon: <Plus />, to: `add-payments` },
                  {
                    label: "Add Payment Method",
                    icon: <Plus />,
                    to: `add-payment-method`,
                  },
                ],
              },
            ]}
          />
        </div>
      </div>

      {showTotals && (
        <div className="px-6 py-3">
          <Text size="small" className="text-ui-fg-subtle">
            {money(totals!.paid, totals!.currency)} paid ·{" "}
            {(totals!.credited ?? 0) > 0 && (
              <>
                {money(totals!.credited, totals!.currency)} credited ·{" "}
              </>
            )}
            {money(totals!.outstanding, totals!.currency)} outstanding
            {totals!.recorded > 0 && (
              <>
                {" · "}
                {money(totals!.recorded, totals!.currency)} recorded separately
              </>
            )}
          </Text>
          {totals!.recorded_against_open > 0 && (
            /* #1710 — the headline figure for the double-pay risk. Its own
               line, not appended to the run-on above, because it is the one
               number here that should stop an action. */
            <Text size="xsmall" className="text-ui-tag-orange-text mt-1">
              ⚠ {money(totals!.recorded_against_open, totals!.currency)} of that
              sits against orders an unpaid payout still bills — settle or link
              it before paying again
            </Text>
          )}
        </div>
      )}

      {isError && (
        /* Never an empty state on failure — that reads as "nobody was paid". */
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">
            Could not load this partner's payments. Nothing below is missing
            because it does not exist — the list simply could not be read.
          </Text>
        </div>
      )}

      {rows.length > 0 && (
        <div className="flex flex-col divide-y px-6 py-2">
          {rows.map((entry) =>
            entry.kind === "payout" ? (
              <PayoutRow key={entry.id} entry={entry} />
            ) : (
              <PaymentRow key={entry.id} entry={entry} />
            )
          )}
        </div>
      )}

      {!isLoading && !isError && rows.length === 0 && (
        <div className="px-6 py-8">
          <Text size="small" className="text-ui-fg-subtle text-center">
            This partner has never been billed or paid.
          </Text>
        </div>
      )}
    </Container>
  )
}
