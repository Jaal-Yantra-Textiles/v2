import {
  Button,
  Container,
  Heading,
  StatusBadge,
  Text,
  toast,
  usePrompt,
} from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import { useParams } from "react-router-dom"

import {
  usePartnerQuote,
  useRevokePartnerQuote,
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
  const prompt = usePrompt()
  const revoke = useRevokePartnerQuote(quoteId!)

  const handleRevoke = async () => {
    /**
     * 🔴 Behind a confirm, and the confirm says what is actually lost.
     *
     * Revoking DELETES the price list behind the quote, so a buyer who has
     * already built a cart at these prices loses them too — not just the link.
     * A partner who reads "revoke this quote?" does not know that; the sentence
     * has to say it.
     */
    const confirmed = await prompt({
      title: t("quotes.revoke.title", "Withdraw this quote?"),
      description: t(
        "quotes.revoke.description",
        "The buyer's link stops working immediately and the prices frozen for them are deleted — including in any cart they have already built. This cannot be undone; a corrected quote has to be minted fresh, which sends them a new number."
      ),
      confirmText: t("quotes.revoke.confirm", "Withdraw"),
      cancelText: t("general.cancel", "Cancel"),
      variant: "danger",
    })
    if (!confirmed) return

    try {
      await revoke.mutateAsync()
      toast.success(
        t("quotes.revoke.success", "Quote withdrawn. The buyer's link is dead.")
      )
    } catch (e: any) {
      // The route's refusals are written for the partner reading them — an
      // accepted quote names who can unwind it — so show the message rather
      // than a generic failure.
      toast.error(
        e?.message ?? t("quotes.revoke.error", "Could not withdraw the quote.")
      )
    }
  }

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

  /**
   * #1510 — the EFFECTIVE status. `status` alone read "Active" on a quote whose
   * link the buyer page was already refusing to price.
   */
  const status =
    (quote as any).status_effective ?? (quote as any).status ?? "active"
  const isAccepted = !!(quote as any).accepted_at
  /**
   * Revoke is offered only while there is something to revoke.
   *
   * An accepted quote is deliberately NOT the partner's to withdraw — the
   * buyer built a cart at these prices and may have paid a deposit against it,
   * so unwinding is an operator's decision with a conversation attached. The
   * route refuses it; this hides the button rather than letting a partner press
   * it and read an error to find out.
   */
  const canRevoke = status === "active" && !isAccepted

  const STATUS_BADGE: Record<
    string,
    { color: "green" | "red" | "orange" | "grey"; label: string }
  > = {
    active: { color: "green", label: t("quotes.status.active", "Active") },
    // Not red: nothing went wrong, the offer simply ran out its clock.
    expired: { color: "grey", label: t("quotes.status.expired", "Expired") },
    // Not red either: a newer quote replaced this one; nobody withdrew it.
    superseded: {
      color: "orange",
      label: t("quotes.status.superseded", "Superseded"),
    },
    revoked: { color: "red", label: t("quotes.status.revoked", "Revoked") },
  }
  const badge = STATUS_BADGE[status] ?? STATUS_BADGE.active

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
            <StatusBadge color={badge.color}>{badge.label}</StatusBadge>
            {/* #1517 — a partner can withdraw their own mis-quote rather than
                asking an operator, or re-minting and emailing the buyer a new
                number they never asked for. */}
            {canRevoke ? (
              <Button
                size="small"
                variant="secondary"
                onClick={handleRevoke}
                isLoading={revoke.isPending}
              >
                {t("quotes.revoke.action", "Withdraw")}
              </Button>
            ) : null}
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
            <div className="flex items-center justify-end gap-x-2">
              <Text size="small">
                {money((quote as any).quoted_freight, (quote as any).currency_code)}
              </Text>
              {/* 🔑 A number a person typed and a number a carrier returned
                  carry different confidence. Rendering them identically
                  launders one into the other — the same argument as the
                  inferred-garment-type badge. */}
              {(quote as any).quoted_freight_source === "manual" ? (
                <StatusBadge color="orange">
                  {t("quotes.freight.byHand", "By hand")}
                </StatusBadge>
              ) : null}
            </div>
          }
        />
        {(quote as any).quoted_freight_basis ? (
          <Field
            label={t("quotes.freight.basis", "Freight basis")}
            value={
              <Text size="small" className="text-ui-fg-subtle">
                {(quote as any).quoted_freight_basis}
              </Text>
            }
          />
        ) : null}
        {/**
         * 🔴 The tax the BUYER is being shown, which this page never displayed.
         *
         * A quote went out taxed at 5% while the cart it becomes charged 18%.
         * Both numbers were on the row the whole time and neither was on any
         * screen a person looks at, so the first sign of trouble was a buyer
         * unable to accept.
         *
         * Shown with its STATUS, never as a bare amount: "zero-rated export"
         * and "we could not work it out" both display as no tax charged and
         * mean completely different things.
         */}
        {(quote as any).quoted_tax_status ? (
          <>
            <Field
              label={
                (quote as any).quoted_tax_inclusive
                  ? t("quotes.tax.includedLabel", "Tax (included in price)")
                  : t("fields.tax", "Tax")
              }
              value={
                <div className="flex items-center justify-end gap-x-2">
                  <Text size="small">
                    {money(
                      (quote as any).quoted_tax_total,
                      (quote as any).currency_code
                    )}
                  </Text>
                  <StatusBadge
                    color={
                      (quote as any).quoted_tax_status === "unknown"
                        ? "orange"
                        : (quote as any).quoted_tax_status === "not_applicable"
                          ? "grey"
                          : "green"
                    }
                  >
                    {t(
                      `quotes.tax.status.${(quote as any).quoted_tax_status}`,
                      String((quote as any).quoted_tax_status).replace(/_/g, " ")
                    )}
                  </StatusBadge>
                </div>
              }
            />
            {(quote as any).quoted_tax_reason ? (
              <Field
                label={t("quotes.tax.basis", "Tax basis")}
                value={
                  // The frozen sentence the buyer is reading, verbatim — so the
                  // partner and the buyer can never be told different stories.
                  <Text size="small" className="text-ui-fg-subtle">
                    {(quote as any).quoted_tax_reason}
                  </Text>
                }
              />
            ) : null}
          </>
        ) : null}
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
