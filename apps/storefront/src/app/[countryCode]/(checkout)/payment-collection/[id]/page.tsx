import { Heading, Text } from "@medusajs/ui"
import type { Metadata } from "next"

import { preparePaymentCollection } from "@lib/data/payment-collections"
import { convertToLocale } from "@lib/util/money"
import PayCollectionForm from "@modules/checkout/components/payment-collection/pay-collection-form"
import StripeWrapper from "@modules/checkout/components/payment-wrapper/stripe-wrapper"
import { loadStripe } from "@stripe/stripe-js"

/**
 * `/payment-collection/:id` — the buyer pays what an order EDIT left owing
 * (#1985).
 *
 * This is the page the admin's "Copy payment link" button points at. It used to
 * point nowhere: `storefrontUrl` was unset, so the copied string had no host,
 * and no storefront implemented this route in either of our two apps.
 *
 * ## Why it lives here rather than on the backend
 *
 * The buyer should land on the shop they bought from, see the order they are
 * topping up, and pay in the shop's own chrome — not on an admin hostname. The
 * backend keeps a `/payment-collection/:id` redirect as a fallback for links
 * already sent.
 *
 * ## The id is the credential
 *
 * Unguessable ULID, handed to one buyer — the same model as the deposit page,
 * the balance page and a PayU link. The route is `noindex` via the checkout
 * layout, and the backend returns only order fields the buyer already has in
 * their confirmation email. `?order_id=` on the incoming link is IGNORED: the
 * order is derived from the collection server-side, so one link can never
 * report another order's contents.
 */
export const metadata: Metadata = {
  title: "Complete your payment",
  robots: { index: false, follow: false },
}

// Money is live and a stale "unpaid" page invites a second payment.
export const dynamic = "force-dynamic"

const stripeKey =
  process.env.NEXT_PUBLIC_STRIPE_KEY ||
  process.env.NEXT_PUBLIC_MEDUSA_PAYMENTS_PUBLISHABLE_KEY

const medusaAccountId = process.env.NEXT_PUBLIC_MEDUSA_PAYMENTS_ACCOUNT_ID
const stripePromise = stripeKey
  ? loadStripe(
      stripeKey,
      medusaAccountId ? { stripeAccount: medusaAccountId } : undefined
    )
  : null

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="content-container flex justify-center py-12">
      <div className="w-full max-w-2xl flex flex-col gap-y-8">{children}</div>
    </div>
  )
}

export default async function PaymentCollectionPage(props: {
  params: Promise<{ id: string; countryCode: string }>
}) {
  const { id } = await props.params
  const prepared = await preparePaymentCollection(id)

  if (!prepared) {
    return (
      <Shell>
        <Heading level="h1" className="text-2xl-semi">
          Payment link
        </Heading>
        <Text className="text-ui-fg-subtle">
          This payment link is not valid. If you were sent it recently, please
          reply to your order email and we will send a new one.
        </Text>
      </Shell>
    )
  }

  const { payment_collection: pc, order, settled } = prepared
  const amountLabel = convertToLocale({
    amount: Number(pc.amount) || 0,
    currency_code: pc.currency_code,
  })

  /**
   * Paid is a first-class page, not an error. A buyer who pays and reopens the
   * link from their email must be told the money arrived, not shown a form that
   * makes them wonder whether it did — or worse, pay twice.
   */
  if (settled) {
    return (
      <Shell>
        <Heading level="h1" className="text-2xl-semi">
          Payment received
        </Heading>
        <Text className="text-ui-fg-subtle">
          {amountLabel} has already been paid
          {order?.display_id ? ` on order #${order.display_id}` : ""}. There is
          nothing more to do — you can close this window.
        </Text>
      </Shell>
    )
  }

  const clientSecret = pc.payment_session?.client_secret ?? null
  const canPay = Boolean(clientSecret && stripePromise && stripeKey)

  return (
    <Shell>
      <div>
        <Heading level="h1" className="text-2xl-semi mb-2">
          Complete your payment
        </Heading>
        <Text className="text-ui-fg-subtle">
          {order?.display_id
            ? `An update to order #${order.display_id} leaves ${amountLabel} to pay.`
            : `There is ${amountLabel} to pay.`}
        </Text>
      </div>

      {order && order.items.length > 0 && (
        <div className="rounded-lg border border-ui-border-base divide-y divide-ui-border-base">
          {order.items.map((item) => (
            <div key={item.id} className="flex items-center gap-x-4 p-4">
              {item.thumbnail && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.thumbnail}
                  alt=""
                  className="h-14 w-14 rounded object-cover bg-ui-bg-subtle"
                />
              )}
              <div className="flex-1 min-w-0">
                <Text className="txt-medium-plus text-ui-fg-base truncate">
                  {item.title}
                </Text>
                {item.variant_title && (
                  <Text className="txt-small text-ui-fg-subtle truncate">
                    {item.variant_title}
                  </Text>
                )}
              </div>
              <Text className="txt-small text-ui-fg-subtle shrink-0">
                × {item.quantity}
              </Text>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-ui-border-base pt-4">
        <Text className="txt-medium-plus text-ui-fg-base">Amount due now</Text>
        <Text className="txt-medium-plus text-ui-fg-base">{amountLabel}</Text>
      </div>

      {canPay ? (
        /* StripeWrapper mounts <Elements>. PayCollectionForm calls useStripe()
           and useElements(), which THROW outside it — so it is only ever
           rendered as its child, never conditionally inside itself. */
        <StripeWrapper
          paymentSession={
            { data: { client_secret: clientSecret } } as any
          }
          stripeKey={stripeKey}
          stripePromise={stripePromise}
        >
          <PayCollectionForm amountLabel={amountLabel} />
        </StripeWrapper>
      ) : (
        <Text className="text-ui-fg-subtle">
          This payment link cannot be opened just now. Please reply to your order
          email and we will send a new one.
        </Text>
      )}
    </Shell>
  )
}
