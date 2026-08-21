import {
  Button,
  Container,
  Heading,
  Prompt,
  StatusBadge,
  Text,
  toast,
} from "@medusajs/ui"
import { useState } from "react"
import { useParams } from "react-router-dom"

import { useQuote, useRevokeQuote } from "../../../hooks/api/quotes"

const money = (amount?: number | null, currency?: string) =>
  amount === null || amount === undefined
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: (currency || "usd").toUpperCase(),
      }).format(amount)

const Field = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="flex items-start justify-between gap-4 px-6 py-3">
    <Text size="small" className="text-ui-fg-subtle">
      {label}
    </Text>
    <div className="text-right">{value}</div>
  </div>
)

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
        <li key={e.id} className="flex gap-3 border-l border-ui-border-base pl-4 pb-4 last:pb-0">
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
    onError: (e: any) => toast.error(e?.message ?? "Could not revoke the quote."),
  })

  if (isLoading || !quote) {
    return (
      <Container>
        <Text size="small" className="text-ui-fg-subtle">
          {isLoading ? "Loading…" : "Quote not found."}
        </Text>
      </Container>
    )
  }

  const isRevoked = quote.status === "revoked"
  // A newer quote for this buyer expired this one's price list (#1435). It is
  // not revocable any more — there is nothing left to delete — but it is also
  // not a withdrawal, so it must not read as one.
  const isSuperseded = quote.status === "superseded"

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <Heading>{quote.recipient_company || quote.recipient_name || "Quote"}</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              {quote.email_sent_to}
            </Text>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge
              color={isRevoked ? "red" : isSuperseded ? "orange" : "green"}
            >
              {isRevoked ? "Revoked" : isSuperseded ? "Superseded" : "Active"}
            </StatusBadge>
            {!isRevoked && !isSuperseded && (
              <Button
                variant="danger"
                size="small"
                onClick={() => setConfirmOpen(true)}
                disabled={isPending}
              >
                Revoke
              </Button>
            )}
          </div>
        </div>

        <Field
          label="Landed total"
          value={
            <Text size="small" weight="plus">
              {money(quote.quoted_landed_total, quote.currency_code)}
            </Text>
          }
        />
        <Field
          label="Freight"
          value={<Text size="small">{money(quote.quoted_freight, quote.currency_code)}</Text>}
        />
        <Field
          label="Destination"
          value={
            <Text size="small">
              {String(quote.destination_country_code || "").toUpperCase()}
              {quote.destination_postal_code ? ` ${quote.destination_postal_code}` : ""}
            </Text>
          }
        />
        <Field
          label="Expires"
          value={
            <Text size="small">
              {quote.expires_at ? new Date(quote.expires_at).toLocaleString() : "—"}
            </Text>
          }
        />
        <Field
          label="Viewed"
          value={
            <Text size="small">
              {Number(quote.view_count || 0) === 0
                ? "Not yet"
                : `${quote.view_count}×${
                    quote.last_viewed_at
                      ? ` · last ${new Date(quote.last_viewed_at).toLocaleString()}`
                      : ""
                  }`}
            </Text>
          }
        />
        {/* 🔴 Stated, not implied. The raw token is returned once at mint and
            only its sha256 is stored, so no read can rebuild the link. Offering
            a "copy link" button here would be a button that cannot work. */}
        <Field
          label="Buyer link"
          value={
            <Text size="small" className="text-ui-fg-subtle">
              Shown once at mint and not recoverable. Re-mint to issue a new one.
            </Text>
          }
        />
      </Container>

      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading level="h2">Activity</Heading>
        </div>
        <Timeline events={quote.events ?? []} />
      </Container>

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
    </div>
  )
}

export const handle = {
  breadcrumb: () => "Quote",
}

export default QuoteDetailPage
