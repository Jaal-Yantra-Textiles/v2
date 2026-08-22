import { Container, Heading, Prompt, StatusBadge, Text, toast } from "@medusajs/ui"
import { XCircle } from "@medusajs/icons"
import { useState } from "react"
import { useParams } from "react-router-dom"

import { CommonSection } from "../../../components/common/section-views"
import { TwoColumnPage } from "../../../components/pages/two-column-pages"
import { TwoColumnPageSkeleton } from "../../../components/table/skeleton"
import { useQuote, useRevokeQuote } from "../../../hooks/api/quotes"

const money = (amount?: number | null, currency?: string) =>
  amount === null || amount === undefined
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: (currency || "usd").toUpperCase(),
      }).format(amount)

/**
 * The activity timeline.
 *
 * 🔑 `actor_type` is rendered, not hidden. An admin-minted quote must never
 * look like one the partner made themselves — that is the first thing asked
 * when a buyer challenges a price.
 */
const ACTOR_LABEL: Record<string, string> = {
  partner: "Partner",
  admin: "Admin",
  buyer: "Buyer",
  system: "System",
}

const Timeline = ({ events }: { events: any[] }) => {
  if (!events?.length) {
    return (
      <div className="px-6 py-6">
        <Text size="small" className="text-ui-fg-subtle">
          No activity recorded yet. Quotes minted before activity logging
          shipped have no history — that is expected, not a gap in this quote.
        </Text>
      </div>
    )
  }

  return (
    <ul className="px-6 py-4">
      {events.map((e) => (
        <li
          key={e.id}
          className="flex gap-3 border-l border-ui-border-base pb-4 pl-4 last:pb-0"
        >
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <Text size="small" weight="plus">
                {e.type}
              </Text>
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

const QuoteDetailPage = () => {
  const { id } = useParams()
  const { quote, isLoading } = useQuote(id!)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const { mutate: revoke, isPending } = useRevokeQuote({
    onSuccess: (data) => {
      toast.success(
        data.price_list_deleted
          ? "Quote revoked and its price list deleted."
          : "Quote revoked. No price list was recorded on it, so none was deleted."
      )
      setConfirmOpen(false)
    },
    onError: (e: any) =>
      toast.error(e?.message ?? "Could not revoke the quote."),
  })

  if (isLoading) {
    return (
      <TwoColumnPageSkeleton mainSections={2} sidebarSections={2} showJSON />
    )
  }

  if (!quote) {
    return (
      <Container>
        <Text size="small" className="text-ui-fg-subtle">
          Quote not found.
        </Text>
      </Container>
    )
  }

  const isRevoked = quote.status === "revoked"
  /**
   * A newer quote for this buyer expired this one's price list (#1435). It is
   * not revocable any more — there is nothing left to delete — but it is also
   * not a withdrawal, so it must not read as one.
   */
  const isSuperseded = quote.status === "superseded"
  const isDead = isRevoked || isSuperseded

  const statusColor: "green" | "red" | "orange" = isRevoked
    ? "red"
    : isSuperseded
      ? "orange"
      : "green"
  const statusLabel = isRevoked
    ? "Revoked"
    : isSuperseded
      ? "Superseded"
      : "Active"

  /**
   * 🔴 Revoke is the only action, and it is destructive: it DELETES the price
   * list behind the quote, so the buyer loses the quoted prices in any cart as
   * well as the link. It stays behind a `Prompt`, and it is omitted entirely on
   * a quote that is already dead rather than shown disabled — an action that
   * cannot do anything invites an operator to hunt for why.
   */
  const actionGroups = isDead
    ? undefined
    : [
        {
          actions: [
            {
              icon: <XCircle />,
              label: "Revoke quote",
              onClick: () => setConfirmOpen(true),
            },
          ],
        },
      ]

  return (
    <>
      <TwoColumnPage
        data={quote as any}
        showJSON
        showMetadata
        hasOutlet={false}
      >
        <TwoColumnPage.Main>
          <CommonSection
            title={quote.recipient_company || quote.recipient_name || "Quote"}
            description={quote.email_sent_to ?? undefined}
            actionGroups={actionGroups}
            fields={[
              {
                label: "Status",
                badge: { value: statusLabel, color: statusColor },
              },
              {
                label: "Landed total",
                value: money(quote.quoted_landed_total, quote.currency_code),
              },
              {
                label: "Freight",
                value: money(quote.quoted_freight, quote.currency_code),
              },
              /**
               * Shown only on a DDP quote, and shown with its basis (#1447).
               * This is a liability we took on: somebody has to arrange the
               * clearance and pay this, and until a carrier can do it that
               * somebody is a person reading this page. A DDP quote whose duty
               * figure is invisible here is one nobody can honour.
               */
              ...(quote.duties_prepaid
                ? [
                    {
                      label: "Duty (we pay)",
                      value: money(
                        quote.quoted_duty_total,
                        quote.currency_code
                      ),
                    },
                    {
                      label: "Duty basis",
                      value: quote.quoted_duty_basis || "—",
                    },
                  ]
                : []),
              {
                label: "Destination",
                value: `${String(quote.destination_country_code || "").toUpperCase()}${
                  quote.destination_postal_code
                    ? ` ${quote.destination_postal_code}`
                    : ""
                }`,
              },
            ]}
          />

          <Container className="divide-y p-0">
            <div className="px-6 py-4">
              <Heading level="h2">Activity</Heading>
              <Text size="small" className="text-ui-fg-subtle">
                Who did what to this quote, and when.
              </Text>
            </div>
            <Timeline events={(quote as any).events ?? []} />
          </Container>
        </TwoColumnPage.Main>

        <TwoColumnPage.Sidebar>
          <CommonSection
            title="Engagement"
            description="Whether the buyer has actually opened it."
            fields={[
              {
                label: "Viewed",
                value:
                  Number(quote.view_count || 0) === 0
                    ? "Not yet"
                    : `${quote.view_count}×`,
              },
              {
                label: "Last viewed",
                value: quote.last_viewed_at
                  ? new Date(quote.last_viewed_at).toLocaleString()
                  : "—",
              },
              {
                label: "Expires",
                value: quote.expires_at
                  ? new Date(quote.expires_at).toLocaleString()
                  : "—",
              },
            ]}
          />

          <CommonSection
            title="Buyer link"
            description="The token is the credential."
            fields={[
              {
                /**
                 * 🔴 Stated, not implied. The raw token is returned once at
                 * mint and only its sha256 is stored, so no read can rebuild
                 * the link. A "copy link" button here would be a button that
                 * cannot work — the UI says so rather than offering one.
                 */
                label: "Recoverable",
                value: "No. Shown once at mint; re-mint to issue a new one.",
              },
            ]}
          />
        </TwoColumnPage.Sidebar>
      </TwoColumnPage>

      <Prompt open={confirmOpen} onOpenChange={setConfirmOpen}>
        <Prompt.Content>
          <Prompt.Header>
            <Prompt.Title>Revoke this quote?</Prompt.Title>
            <Prompt.Description>
              This deletes the price list behind the quote, so the buyer loses
              the quoted prices in any cart as well as the link. It cannot be
              undone — issuing the prices again means minting a new quote.
            </Prompt.Description>
          </Prompt.Header>
          <Prompt.Footer>
            <Prompt.Cancel>Cancel</Prompt.Cancel>
            <Prompt.Action onClick={() => revoke(quote.id)}>
              {isPending ? "Revoking…" : "Revoke"}
            </Prompt.Action>
          </Prompt.Footer>
        </Prompt.Content>
      </Prompt>
    </>
  )
}

export const handle = {
  breadcrumb: () => "Quote",
}

export default QuoteDetailPage
