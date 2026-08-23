import { Container, Heading, StatusBadge, Text } from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import { useParams } from "react-router-dom"

import {
  usePartnerQuote,
  type PartnerQuoteEvent,
} from "../../../hooks/api/partner-quotes"
import { PaymentSchedulePanel } from "./components/payment-schedule-panel"

/**
 * A partner's own quote, in detail (#1389 S5).
 *
 * The list answers "what have I quoted"; this answers "what exactly did I quote
 * this buyer, and what has happened since". The second question is the one asked
 * when a buyer comes back to argue about a price.
 */

const money = (amount?: number | null, currency?: string) =>
  amount === null || amount === undefined
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: (currency || "inr").toUpperCase(),
      }).format(amount)

const Field = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="flex items-start justify-between gap-4 px-6 py-3">
    <Text size="small" className="text-ui-fg-subtle">
      {label}
    </Text>
    <div className="text-right">{value}</div>
  </div>
)

const ACTOR_LABEL: Record<string, string> = {
  partner: "You",
  admin: "Admin",
  buyer: "Buyer",
  system: "System",
}

const Timeline = ({ events }: { events: PartnerQuoteEvent[] }) => {
  const { t } = useTranslation()

  if (!events?.length) {
    return (
      <div className="px-6 py-6">
        <Text size="small" className="text-ui-fg-subtle">
          {t(
            "quotes.activity.empty",
            "No activity yet. Quotes minted before activity logging shipped have no history — that is expected, not a gap in this quote."
          )}
        </Text>
      </div>
    )
  }

  return (
    <ul className="px-6 py-4">
      {events.map((e) => (
        <li
          key={e.id}
          className="flex gap-3 border-l border-ui-border-base pl-4 pb-4 last:pb-0"
        >
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <Text size="small" weight="plus">
                {e.type}
              </Text>
              {/* 🔑 Shown, not hidden: a quote an admin minted on your behalf
                  must never look like one you minted yourself. */}
              <StatusBadge color={e.actor_type === "buyer" ? "blue" : "grey"}>
                {ACTOR_LABEL[e.actor_type] ?? e.actor_type}
              </StatusBadge>
            </div>
            {e.message ? (
              <Text size="small" className="text-ui-fg-subtle">
                {e.message}
              </Text>
            ) : null}
            <Text size="xsmall" className="text-ui-fg-muted">
              {new Date(e.created_at).toLocaleString()}
            </Text>
          </div>
        </li>
      ))}
    </ul>
  )
}

export const QuoteDetail = () => {
  const { t } = useTranslation()
  // Named `quoteId` in the route map, not `id`: a sibling `:id` already
  // exists under /orders for retail orders, and two params called `id` in one
  // branch resolve to whichever matched last.
  const { quoteId } = useParams()
  const { quote, isLoading } = usePartnerQuote(quoteId!)

  if (isLoading || !quote) {
    return (
      <Container>
        <Text size="small" className="text-ui-fg-subtle">
          {isLoading
            ? t("general.loading", "Loading…")
            : t("quotes.notFound", "Quote not found.")}
        </Text>
      </Container>
    )
  }

  const isRevoked = (quote as any).status === "revoked"

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <Heading>
              {(quote as any).recipient_company ||
                (quote as any).recipient_name ||
                t("quotes.title", "Quote")}
            </Heading>
            <Text size="small" className="text-ui-fg-subtle">
              {(quote as any).email_sent_to}
            </Text>
          </div>
          <div className="flex items-center gap-2">
            {/* Acceptance is its own badge, not a replacement for the status.
                An accepted quote is still an active one until it is paid, and
                collapsing the two would hide which of them a buyer is in. */}
            {(quote as any).accepted_at ? (
              <StatusBadge color="blue">
                {t("quotes.status.accepted", "Accepted")}
              </StatusBadge>
            ) : null}
            <StatusBadge color={isRevoked ? "red" : "green"}>
              {isRevoked
                ? t("quotes.status.revoked", "Revoked")
                : t("quotes.status.active", "Active")}
            </StatusBadge>
          </div>
        </div>

        <Field
          label={t("fields.landedTotal", "Landed total")}
          value={
            <Text size="small" weight="plus">
              {money(
                (quote as any).quoted_landed_total,
                (quote as any).currency_code
              )}
            </Text>
          }
        />
        <Field
          label={t("fields.freight", "Freight")}
          value={
            <Text size="small">
              {money((quote as any).quoted_freight, (quote as any).currency_code)}
            </Text>
          }
        />
        <Field
          label={t("quotes.fields.depositTerms", "Deposit terms")}
          value={
            <Text size="small">
              {/* 🔑 null and 0 are different answers and are shown as such.
                  Null means no terms were named and the platform default
                  applies at acceptance; 0 means this buyer pays nothing up
                  front. Rendering both as "0%" would misstate one of them. */}
              {(quote as any).deposit_pct === null ||
              (quote as any).deposit_pct === undefined
                ? t("quotes.fields.depositDefault", "Default (30%)")
                : `${(quote as any).deposit_pct}%`}
            </Text>
          }
        />
        <Field
          label={t("fields.destination", "Destination")}
          value={
            <Text size="small">
              {String((quote as any).destination_country_code || "").toUpperCase()}
              {(quote as any).destination_postal_code
                ? ` ${(quote as any).destination_postal_code}`
                : ""}
            </Text>
          }
        />
        <Field
          label={t("fields.expiresAt", "Expires")}
          value={
            <Text size="small">
              {(quote as any).expires_at
                ? new Date((quote as any).expires_at).toLocaleString()
                : "—"}
            </Text>
          }
        />
        <Field
          label={t("fields.viewed", "Viewed")}
          value={
            <Text size="small">
              {Number((quote as any).view_count || 0) === 0
                ? t("quotes.notViewed", "Not yet")
                : `${(quote as any).view_count}×`}
            </Text>
          }
        />
        {/* 🔴 Stated plainly. The raw token is returned once at mint and only
            its sha256 is stored, so nothing can rebuild the link — a "copy
            link" button here would be a button that cannot work. */}
        <Field
          label={t("quotes.minted.buyerLink", "Buyer link")}
          value={
            <Text size="small" className="text-ui-fg-subtle">
              {t(
                "quotes.linkNotRecoverable",
                "Shown once at mint and not recoverable. Mint a new quote to issue a fresh link."
              )}
            </Text>
          }
        />
      </Container>

      {(quote as any).accepted_at ? (
        <Container className="divide-y p-0">
          <div className="flex items-center justify-between px-6 py-4">
            <Heading level="h2">
              {t("quotes.payment.title", "Payment")}
            </Heading>
            <Text size="small" className="text-ui-fg-subtle">
              {t("quotes.payment.acceptedOn", "Accepted {{when}}", {
                when: new Date((quote as any).accepted_at).toLocaleString(),
              })}
            </Text>
          </div>
          <PaymentSchedulePanel
            schedule={(quote as any).payment_schedule}
            acceptedAt={(quote as any).accepted_at}
          />
        </Container>
      ) : null}

      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading level="h2">{t("quotes.activity.title", "Activity")}</Heading>
        </div>
        <Timeline events={((quote as any).events ?? []) as PartnerQuoteEvent[]} />
      </Container>
    </div>
  )
}
