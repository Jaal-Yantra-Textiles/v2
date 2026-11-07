import { useMemo, useState } from "react"
import { Button, Drawer, Input, Label, Text, toast } from "@medusajs/ui"

import {
  useSplitPayment,
  type PartnerLedgerEntry,
} from "../../hooks/api/payments"
import {
  checkShares,
  payoutRemaining,
  suggestShares,
  type OpenPayout,
} from "../../lib/payment-allocation"

const money = (amount: number, currency?: string | null) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: (currency || "inr").toUpperCase(),
    maximumFractionDigits: 2,
  }).format(Number(amount ?? 0))

/**
 * "Pay bills with this payment" — split ONE payment across the partner's open
 * payouts, naming each share (#2523).
 *
 * HR Handloom, 2026-11-05: 25,000 paid "against the total" of three bills.
 * The ledger fold could spread one payment over several payouts (#1712), but
 * the link itself was one-payout-per-payment, so no route could ever write that
 * shape. With the link many-to-many, this is where a person says "this much to
 * that bill".
 *
 * Opens on the oldest-first split — what the ledger does when nobody names a
 * share — so leaving the numbers alone changes nothing about how the money is
 * read, it only makes the split explicit. A share of 0 writes nothing.
 *
 * ⚠️ A payout's room is what it still claims NOW, which already excludes money
 * this payment gave it. Re-splitting a payment that is already linked can
 * therefore show less room than the payout really has for it; the server is
 * the judge and refuses, with both numbers, rather than clamping.
 */
export const AllocatePaymentDrawer = ({
  open,
  onOpenChange,
  paymentId,
  paymentAmount,
  currency,
  payouts,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  paymentId: string
  paymentAmount: number
  currency: string | null
  /** The partner's ledger payout entries; only open ones are offered. */
  payouts: PartnerLedgerEntry[]
}) => {
  const { mutateAsync: splitPayment, isPending: isSaving } =
    useSplitPayment(paymentId)

  const openPayouts: OpenPayout[] = useMemo(
    () =>
      payouts
        .filter(
          (e) =>
            e.kind === "payout" &&
            e.submission_id &&
            !["Paid", "Rejected"].includes(String(e.status))
        )
        .map((e) => ({
          submission_id: e.submission_id!,
          remaining: payoutRemaining(e),
          submitted_at: e.submitted_at ?? null,
        }))
        .filter((p) => p.remaining > 0),
    [payouts]
  )

  const [shares, setShares] = useState<Record<string, number>>(() =>
    suggestShares(paymentAmount, openPayouts)
  )

  const verdict = checkShares(paymentAmount, shares, openPayouts)

  const save = async () => {
    if (verdict.problems.length) return
    try {
      const { written } = await splitPayment(shares)
      toast.success(
        `${money(verdict.total, currency)} split across ${written} bill${written === 1 ? "" : "s"}`
      )
      onOpenChange(false)
    } catch (e: any) {
      toast.error(e?.message || "Could not save the split")
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>Pay bills with this payment</Drawer.Title>
          <Drawer.Description>
            {money(paymentAmount, currency)} — say how much of it goes to each
            open bill.
          </Drawer.Description>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-y-4">
          {openPayouts.length === 0 && (
            <Text size="small" className="text-ui-fg-subtle">
              This partner has no open bills to pay. Raise a payout first.
            </Text>
          )}
          {openPayouts.map((p) => (
            <div key={p.submission_id} className="flex flex-col gap-y-1">
              <Label size="small" htmlFor={`share-${p.submission_id}`}>
                <span className="font-mono">{p.submission_id}</span>
                <span className="text-ui-fg-subtle">
                  {" "}
                  — still claims {money(p.remaining, currency)}
                </span>
              </Label>
              <Input
                id={`share-${p.submission_id}`}
                data-testid={`share-${p.submission_id}`}
                type="number"
                min={0}
                step="0.01"
                value={shares[p.submission_id] ?? 0}
                onChange={(e) =>
                  setShares((prev) => ({
                    ...prev,
                    [p.submission_id]: Number(e.target.value),
                  }))
                }
              />
            </div>
          ))}
          <Text size="small" data-testid="allocation-summary">
            {money(verdict.total, currency)} to bills ·{" "}
            {money(Math.max(verdict.left, 0), currency)} left unallocated
          </Text>
          {verdict.problems.map((problem) => (
            <Text key={problem} size="xsmall" className="text-ui-fg-error">
              {problem}
            </Text>
          ))}
        </Drawer.Body>
        <Drawer.Footer>
          <Drawer.Close asChild>
            <Button variant="secondary" size="small" disabled={isSaving}>
              Cancel
            </Button>
          </Drawer.Close>
          <Button
            size="small"
            onClick={() => void save()}
            isLoading={isSaving}
            disabled={verdict.problems.length > 0 || verdict.total <= 0}
          >
            Save split
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}
