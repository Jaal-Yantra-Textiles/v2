import { Alert, Button, Heading, Input, Text, toast } from "@medusajs/ui"

/** What the link's delivery actually did. Mirrors the quote's (#1420). */
export type DesignOrderEmailDelivery = {
  sent: boolean
  to: string | null
  reason: string | null
}

/** What `POST /admin/designs/draft-order` (and its customer twin) returns. */
export type CreatedDesignOrder = {
  cart: any
  email?: DesignOrderEmailDelivery
  /** Null when we could not name the buyer's shop. `checkout_url_reason` says why. */
  checkout_url: string | null
  checkout_url_reason?: string | null
  /** A PayU link that completes THIS cart. Null off INR — the ordinary case. */
  payment_link?: string | null
  payment_link_reason?: string | null
}

/**
 * What the operator sees after a design order is created.
 *
 * ## Why this exists
 *
 * Both create paths ended on a toast reading *"Share the checkout link with the
 * customer to complete payment"* — and then showed no link. The response
 * carried `checkout_url` the whole time and both call sites discarded it
 * (`designs/page.tsx`, `start-design-order-wizard.tsx`). The operator was
 * instructed to share something they were never given.
 *
 * 🔑 Unlike the quote's minted panel, nothing here is one-shot: the cart id is
 * on the order and the link can be rebuilt. So this informs rather than alarms —
 * the one loud case is a link we could NOT build, because that is a real gap
 * between what the operator was told to do and what they can do.
 */
export const DesignOrderCreatedPanel = ({
  result,
}: {
  result: CreatedDesignOrder
}) => {
  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(`${label} copied`)
    } catch {
      toast.error("Could not copy — select and copy manually.")
    }
  }

  const LinkRow = ({ label, value }: { label: string; value: string }) => (
    <div className="flex flex-col gap-y-2">
      <Text size="small" weight="plus">
        {label}
      </Text>
      <div className="flex gap-2">
        <Input readOnly value={value} />
        <Button variant="secondary" onClick={() => copy(value, label)}>
          Copy
        </Button>
      </div>
    </div>
  )

  return (
    <div className="flex flex-col gap-y-6 px-6 py-6">
      <div>
        <Heading>Design order created</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Send the customer one of these to collect payment.
        </Text>
      </div>

      {/*
        🔑 Three outcomes, not two. "Sent" and "not sent" are the obvious pair,
        but the commonest case here is a design order with NO buyer attached —
        ordinary on this platform (#1817), and not a failure to report. Spelling
        it as an error would train the operator to ignore the real ones.
      */}
      {result.email?.sent ? (
        <Alert variant="success">
          Sent to {result.email.to}. They have the link.
        </Alert>
      ) : result.email?.to ? (
        <Alert variant="error">
          The link was NOT emailed —{" "}
          {result.email.reason ?? "the send did not go through."} Copy it below
          and send it yourself.
        </Alert>
      ) : (
        <Alert variant="info">
          {result.email?.reason ??
            "No buyer is attached yet, so nothing was emailed."}
        </Alert>
      )}

      {result.checkout_url ? (
        <LinkRow label="Checkout link" value={result.checkout_url} />
      ) : (
        /**
         * 🔴 Loud on purpose. A missing link means we could not work out which
         * storefront this buyer belongs to — building one anyway is what sent
         * an INR cart to a EUR checkout (#2051).
         */
        <Alert variant="error">
          The order was created, but there is no checkout link to share —{" "}
          {result.checkout_url_reason ??
            "we could not work out which storefront this order belongs to."}
        </Alert>
      )}

      {result.payment_link ? (
        <LinkRow label="PayU payment link" value={result.payment_link} />
      ) : (
        <Text size="small" className="text-ui-fg-subtle">
          No PayU link:{" "}
          {result.payment_link_reason ?? "none was created for this order."}
        </Text>
      )}

    </div>
  )
}
