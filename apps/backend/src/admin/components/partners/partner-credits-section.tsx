import { Badge, Button, Container, Heading, StatusBadge, Text, toast } from "@medusajs/ui"
import { Link } from "react-router-dom"

import {
  usePartnerCredits,
  usePartnerLedger,
  useApplyPartnerCredit,
  type PartnerCredit,
  type PartnerLedgerEntry,
} from "../../hooks/api/payments"
import { remainingClaim } from "../../../modules/internal_payments/lib/apply-credit"

/**
 * Money this partner already holds, and the one thing you can do with it (#1712).
 *
 * 🔴 Why this panel has to exist. A credit was recordable and readable and
 * nothing more: `status` starts `Open`, is DISPLAYED beside `outstanding` and
 * never netted against it, because whether money already given discharges the
 * next payout is a decision a human makes. There was no screen on which a
 * human could make it — a capability with no screen is no capability (#1612,
 * where `inventory_order_lines` had a validator, a guard, tranche folding and
 * zero rows).
 *
 * 🔑 And the earmark. The create route writes TWO links — partner→credit and
 * inventory_order→credit — and until #1712's follow-up no read exposed the
 * second, so "this 1,380 is earmarked against order 01K36TE2WB" was a fact the
 * database held and no surface showed.
 */

const money = (amount: number | null | undefined, currency?: string | null) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: (currency || "inr").toUpperCase(),
    maximumFractionDigits: 2,
  }).format(Number(amount ?? 0))

const day = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString() : null

const statusColor = (status: string) =>
  status === "Applied" ? "green" : status === "Cancelled" ? "red" : "orange"

/**
 * How much of a payout a credit could still discharge.
 *
 * 🔑 Imported from the module lib the ROUTE checks with, never re-derived here.
 * A screen that computes a money figure its own way is how a derived rate
 * outranked the server's pricer and re-priced a ₹10,000 job to ₹12,857 (#1679).
 *
 * ⚠️ Advisory even so. This decides what the picker DISABLES; the server
 * decides what is allowed, and refuses with both numbers named. If the two ever
 * disagree the operator sees the server's message, not a silent no-op.
 */
const remainingFor = (entry: PartnerLedgerEntry) =>
  remainingClaim({
    submissionAmount: entry.amount,
    settledAmount: entry.settled_amount ?? 0,
    appliedCreditsTotal: entry.credited_amount ?? 0,
  })

/** A payout a credit could be applied to, with why it can or cannot be. */
type Candidate = {
  entry: PartnerLedgerEntry
  remaining: number
  blocked: string | null
}

const ApplyControl = ({
  partnerId,
  credit,
  candidates,
}: {
  partnerId: string
  credit: PartnerCredit
  candidates: Candidate[]
}) => {
  const { mutateAsync, isPending } = useApplyPartnerCredit(partnerId, credit.id)

  if (!candidates.length) {
    /**
     * ⚠️ Says WHY, never renders an empty picker. An empty control reads as
     * "this is broken"; the real answer is usually that every payout is
     * already settled.
     */
    return (
      <Text size="xsmall" className="text-ui-fg-muted">
        No payout is open to apply this against — every claim is Paid, Rejected,
        or already fully covered.
      </Text>
    )
  }

  const handleApply = (chosen: Candidate) => {
    if (chosen.blocked || isPending) return
    /**
     * 🔴 Confirmed because it is FORWARD-ONLY. There is no unapply: reversing a
     * settled money decision is a new decision with its own reason. A one-click
     * irreversible money write with no confirmation is how the wrong payout
     * gets discharged at 11pm.
     */
    const ok = window.confirm(
      `Apply ${money(credit.amount, credit.currency_code)} to payout ${chosen.entry.submission_id}?\n\n` +
        `That payout still claims ${money(chosen.remaining, chosen.entry.currency)}, and will claim ` +
        `${money(chosen.remaining - Number(credit.amount ?? 0), chosen.entry.currency)} after.\n\n` +
        `This cannot be undone.`
    )
    if (!ok) return

    void (async () => {
      try {
        const res = await mutateAsync({
          submission_id: chosen.entry.submission_id!,
        })
        toast.success(
          `Applied — that payout now claims ${money(res.remaining_after, chosen.entry.currency)}`
        )
      } catch (e: any) {
        /**
         * The server's refusal names both numbers. Surfacing it verbatim beats
         * "Could not apply", which sends an operator to the database to find
         * out why — and gets worked around by editing rows directly.
         */
        toast.error(e?.message || "Could not apply this credit")
      }
    })()
  }

  /**
   * 🔴 A visible list, deliberately NOT a dropdown.
   *
   * A `Select` renders its options only when opened, so every reason a payout
   * cannot take this credit — "credit is larger than this", "nothing left to
   * claim" — would be hidden behind a click, and invisible to any test that
   * renders the screen. On a money decision the reasons ARE the screen.
   */
  return (
    <div className="flex flex-col gap-y-1 rounded-md bg-ui-bg-subtle px-3 py-2">
      <Text size="xsmall" className="text-ui-fg-muted">
        Apply to a payout
      </Text>
      {candidates.map((c) => (
        <div
          key={c.entry.submission_id}
          className="flex items-center justify-between gap-x-3"
        >
          <Text size="xsmall" className="text-ui-fg-subtle">
            <span className="font-mono">{c.entry.submission_id}</span> ·{" "}
            {money(c.remaining, c.entry.currency)} still claimed
            {c.blocked ? ` — ${c.blocked}` : ""}
          </Text>
          <Button
            size="small"
            variant="secondary"
            disabled={!!c.blocked || isPending}
            onClick={() => handleApply(c)}
            data-testid={`apply-credit-${credit.id}-${c.entry.submission_id}`}
          >
            Apply
          </Button>
        </div>
      ))}
    </div>
  )
}

const CreditRow = ({
  partnerId,
  credit,
  candidates,
}: {
  partnerId: string
  credit: PartnerCredit
  candidates: Candidate[]
}) => {
  const isOpen = credit.status === "Open"

  return (
    <div className="flex flex-col gap-y-2 py-3">
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-y-1">
          <div className="flex items-center gap-x-2">
            <StatusBadge color={statusColor(credit.status)}>
              {credit.status}
            </StatusBadge>
            <Text size="small" className="text-ui-fg-subtle">
              {credit.source_type || "credit"}
            </Text>
          </div>
          {/**
           * 🔑 The reason, always. A bare amount with no statement of origin is
           * the shape that let `metadata` blobs decide payouts (#1557) — the
           * next reader has to be able to audit it without this session's
           * transcript.
           */}
          <Text size="xsmall" className="text-ui-fg-muted">
            {credit.reason || "No reason recorded"}
          </Text>
          {credit.inventory_order_id && (
            /* The earmark — where the founder decided it should be consumed.
               Advisory: it does not restrict which payout it may be applied to. */
            <Text size="xsmall" className="text-ui-fg-muted">
              earmarked against order{" "}
              <span className="font-mono">{credit.inventory_order_id}</span>
            </Text>
          )}
          {credit.applied_to_submission_id && (
            <Text size="xsmall" className="text-ui-fg-muted">
              applied to{" "}
              <Link
                to={`/payment-submissions/${credit.applied_to_submission_id}`}
                className="text-ui-fg-interactive font-mono hover:underline"
              >
                {credit.applied_to_submission_id}
              </Link>
              {credit.applied_at ? ` on ${day(credit.applied_at)}` : ""}
            </Text>
          )}
        </div>
        <Text size="small" weight="plus">
          {money(credit.amount, credit.currency_code)}
        </Text>
      </div>
      {isOpen && (
        <ApplyControl
          partnerId={partnerId}
          credit={credit}
          candidates={candidates}
        />
      )}
    </div>
  )
}

export const PartnerCreditsSection = ({ partnerId }: { partnerId: string }) => {
  const { credits, open_total, currency, isLoading, isError } =
    usePartnerCredits(partnerId, { enabled: !!partnerId })

  /**
   * The payouts a credit could discharge, read from the ledger this panel sits
   * beside — never a second fetch of the submissions with its own rules. Two
   * surfaces answering "what does this partner still claim" is how they start
   * disagreeing about a money figure.
   */
  const { entries } = usePartnerLedger(partnerId, { enabled: !!partnerId })

  const rows: PartnerCredit[] = credits || []

  const candidatesFor = (credit: PartnerCredit): Candidate[] =>
    (entries || [])
      .filter((e) => e.kind === "payout" && e.submission_id)
      .filter((e) => e.status !== "Paid" && e.status !== "Rejected")
      .map((entry) => {
        const remaining = remainingFor(entry)
        const amount = Number(credit.amount ?? 0)
        return {
          entry,
          remaining,
          /**
           * ⚠️ A credit applies WHOLE — there is no partial application — so a
           * payout with less headroom than the credit is offered and disabled
           * with the reason, rather than hidden. Hiding it leaves an operator
           * wondering where the payout went.
           */
          blocked:
            remaining <= 0
              ? "nothing left to claim"
              : amount > remaining
                ? "credit is larger than this"
                : null,
        }
      })

  return (
    <Container className="divide-y p-0" data-partner-id={partnerId}>
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-2">
          <Heading level="h2">Credits</Heading>
          <Badge size="2xsmall" className="ml-2">
            {rows.length}
          </Badge>
        </div>
        {(open_total ?? 0) > 0 && (
          <Text size="small" className="text-ui-fg-subtle">
            {money(open_total, currency)} held
          </Text>
        )}
      </div>

      {isError && (
        /* Never an empty state on failure — that reads as "they hold nothing",
           which is precisely the reading that lets a credit be paid twice. */
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">
            Could not load this partner's credits. Nothing below is missing
            because it does not exist — the list simply could not be read.
          </Text>
        </div>
      )}

      {rows.length > 0 && (
        <div className="flex flex-col divide-y px-6 py-2">
          {rows.map((credit) => (
            <CreditRow
              key={credit.id}
              partnerId={partnerId}
              credit={credit}
              candidates={candidatesFor(credit)}
            />
          ))}
        </div>
      )}

      {!isLoading && !isError && rows.length === 0 && (
        <div className="px-6 py-8">
          <Text size="small" className="text-ui-fg-subtle text-center">
            This partner holds no credit — nothing has been paid to them that a
            payout did not consume.
          </Text>
        </div>
      )}
    </Container>
  )
}
