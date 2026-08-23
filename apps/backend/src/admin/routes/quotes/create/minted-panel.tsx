import { Alert, Button, Heading, Input, Text, toast } from "@medusajs/ui"
import { useNavigate } from "react-router-dom"

/** What the buyer link's delivery actually did (#1420). */
export type QuoteEmailDelivery = {
  sent: boolean
  to: string | null
  buyer_url: string | null
  reason: string | null
}

export type MintedQuoteResult = {
  token: string
  quote: any
  buyer_url: string | null
  email?: QuoteEmailDelivery
}

/**
 * The post-mint panel — and the ONLY place the buyer's link ever exists.
 *
 * 🔴 `token` is returned by the mint and never again: the row stores only its
 * sha256, so no later read can reconstruct a working link. Everything about
 * this screen is shaped by that — it replaces the form rather than sitting
 * beside it, and it does not offer a way onward that skips copying.
 *
 * ## The link used to be built here, and was always broken (#1420)
 *
 * This panel composed `https://<host>/<cc>/quotes/<token>` from
 * `quote.storefront_domain` / `quote.custom_domain` — neither of which exists
 * on `partner_quote`. Both were always `undefined`, so an admin mint has never
 * produced a buyer link at all: the panel silently fell through to its "no
 * domain connected" branch and handed over a bare token. The partner panel had
 * its own, different copy of the same rule, and neither honoured
 * `custom_domain_verified`. The server composes it once now; this reads it.
 */
export const MintedPanel = ({ result }: { result: MintedQuoteResult }) => {
  const navigate = useNavigate()

  const { token, quote } = result
  const link = result.buyer_url
  // 🔴 Not a warning — a task. The buyer has no other copy of this link.
  const emailSent = Boolean(result.email?.sent)

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(`${label} copied`)
    } catch {
      toast.error("Could not copy — select and copy manually.")
    }
  }

  return (
    <div className="flex flex-col gap-y-6 px-6 py-6">
      <div>
        <Heading>Quote minted</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          This link is shown once. Only its hash is stored, so it cannot be
          recovered later — if you lose it, mint the quote again.
        </Text>
      </div>

      {emailSent ? (
        <Alert variant="success">
          Sent to {result.email?.to}. They have the link.
        </Alert>
      ) : (
        <Alert variant="error">
          The quote was NOT emailed —{" "}
          {result.email?.reason ?? "the send did not go through."} Copy the link
          below and send it yourself before you leave this page.
        </Alert>
      )}

      {link ? (
        <div className="flex flex-col gap-y-2">
          <Text size="small" weight="plus">
            Buyer link
          </Text>
          <div className="flex gap-2">
            <Input readOnly value={link} />
            <Button variant="secondary" onClick={() => copy(link, "Link")}>
              Copy
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-y-2">
          <Text size="small" className="text-ui-fg-subtle">
            This partner has no verified storefront domain, so there is no buyer
            link to share. Copy the token and connect a domain first.
          </Text>
          <div className="flex gap-2">
            <Input readOnly value={token} />
            <Button variant="secondary" onClick={() => copy(token, "Token")}>
              Copy
            </Button>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button
          variant="secondary"
          onClick={() => navigate(`/quotes/${quote?.id}`)}
        >
          View quote
        </Button>
        <Button onClick={() => navigate("/quotes")}>
          {emailSent ? "Done" : "I've copied the link"}
        </Button>
      </div>
    </div>
  )
}
