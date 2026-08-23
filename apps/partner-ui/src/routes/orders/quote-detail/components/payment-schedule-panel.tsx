import { Heading, StatusBadge, Text } from "@medusajs/ui"
import { useTranslation } from "react-i18next"

import type { PartnerQuotePaymentSchedule } from "../../../../hooks/api/partner-quotes"

/**
 * What the buyer has paid, and what is still owed (#1439 S11).
 *
 * Rendered only once a quote has been accepted. Before that there is no
 * schedule and nothing to say — an empty "0 paid" panel on every unaccepted
 * quote would read as a buyer who has failed to pay rather than one who has
 * not yet been asked.
 */

const money = (amount?: number | null, currency?: string) =>
  amount === null || amount === undefined
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: (currency || "inr").toUpperCase(),
      }).format(Number(amount))

/**
 * 🔑 `waived` is amber, never green. A partner taking a trusted buyer on
 * account is a decision worth seeing at a glance; painting it the same colour
 * as money that actually arrived is how a receivable goes missing.
 */
const TONE: Record<string, "green" | "orange" | "red" | "grey"> = {
  paid: "green",
  waived: "orange",
  due: "orange",
  failed: "red",
  pending: "grey",
  not_due: "grey",
}

const RAIL_LABEL: Record<string, string> = {
  payu: "PayU",
  stripe: "Stripe",
  manual: "Off-platform",
}

const Row = ({
  label,
  amount,
  currency,
  status,
  statusLabel,
  hint,
}: {
  label: string
  amount?: number | null
  currency?: string
  status?: string
  statusLabel?: string
  hint?: string
}) => (
  <div className="flex items-start justify-between gap-4 px-6 py-3">
    <div className="flex flex-col">
      <Text size="small" className="text-ui-fg-subtle">
        {label}
      </Text>
      {hint ? (
        <Text size="xsmall" className="text-ui-fg-muted">
          {hint}
        </Text>
      ) : null}
    </div>
    <div className="flex items-center gap-2">
      <Text size="small" weight="plus">
        {money(amount, currency)}
      </Text>
      {status ? (
        <StatusBadge color={TONE[status] ?? "grey"}>
          {statusLabel ?? status}
        </StatusBadge>
      ) : null}
    </div>
  </div>
)

export const PaymentSchedulePanel = ({
  schedule,
  acceptedAt,
}: {
  schedule?: PartnerQuotePaymentSchedule | null
  acceptedAt?: string | null
}) => {
  const { t } = useTranslation()

  if (!acceptedAt) {
    return null
  }

  // Accepted, but no ledger row. Said out loud rather than rendered as an empty
  // panel: it means acceptance got as far as a cart and no further, and that is
  // a state someone needs to go and look at.
  if (!schedule) {
    return (
      <div className="px-6 py-6">
        <Text size="small" className="text-ui-fg-subtle">
          {t(
            "quotes.payment.missingSchedule",
            "This quote was accepted but has no payment schedule. The acceptance did not finish — nothing has been charged."
          )}
        </Text>
      </div>
    )
  }

  const statusLabel = (s: string) =>
    t(`quotes.payment.status.${s}`, s.replace("_", " "))

  return (
    <>
      <Row
        label={t("quotes.payment.totalDue", "Total")}
        amount={schedule.total_due}
        currency={schedule.currency_code}
      />
      <Row
        label={t("quotes.payment.deposit", "Deposit")}
        hint={t("quotes.payment.depositPct", "{{pct}}% up front", {
          pct: schedule.deposit_pct,
        })}
        amount={schedule.deposit_amount}
        currency={schedule.currency_code}
        status={schedule.deposit_status}
        statusLabel={statusLabel(schedule.deposit_status)}
      />
      <Row
        label={t("quotes.payment.balance", "Balance")}
        hint={
          schedule.balance_status === "not_due"
            ? t(
                "quotes.payment.balanceNotDue",
                "Invoiced when the goods are ready"
              )
            : undefined
        }
        amount={schedule.balance_amount}
        currency={schedule.currency_code}
        status={schedule.balance_status}
        statusLabel={statusLabel(schedule.balance_status)}
      />
      <div className="flex items-center justify-between gap-4 px-6 py-3">
        <Text size="small" className="text-ui-fg-subtle">
          {t("quotes.payment.rail", "Collected via")}
        </Text>
        <Text size="small">{RAIL_LABEL[schedule.rail] ?? schedule.rail}</Text>
      </div>
    </>
  )
}
