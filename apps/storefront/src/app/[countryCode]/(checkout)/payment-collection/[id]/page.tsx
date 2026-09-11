import { Heading, Text } from "@medusajs/ui"
import type { Metadata } from "next"

import { preparePaymentCollection } from "@lib/data/payment-collections"
import { convertToLocale } from "@lib/util/money"
import PayCollectionWrapper from "@modules/checkout/components/payment-collection/pay-collection-wrapper"

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
  const result = await preparePaymentCollection(id)

  /**
   * 🔴 "Down" and "dead link" are DIFFERENT PAGES.
   *
   * Both used to render "This payment link is not valid", because every failure
   * collapsed to null. That sentence sends a buyer whose link is perfectly fine
   * off to ask for a replacement they do not need — and the replacement will
   * fail in exactly the same way, because the fault is ours. Observed live when
   * the storefront deployed ahead of the backend.
   */
  if (result.state === "unavailable") {
    return (
      <Shell>
        <Heading level="h1" className="text-2xl-semi">
          We can&apos;t load this payment right now
        </Heading>
        <Text className="text-ui-fg-subtle">
          Something on our side is not responding, so we can&apos;t show your
          payment yet. Your link is fine — please refresh this page in a few
          minutes and it should work.
        </Text>
        <Text className="text-ui-fg-subtle txt-small">
          Nothing has been charged, and your order is unaffected. If it still
          won&apos;t load after a few tries, reply to your order email and we
          will sort it out.
        </Text>
      </Shell>
    )
  }

  if (result.state === "not_found") {
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

  const { payment_collection: pc, order, settled } = result.prepared
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

  /**
   * 🔴 Only show the order's own figures when they are in the SAME currency as
   * the amount due. A collection is normally in its order's currency, but when
   * they disagree the breakdown becomes nonsense a buyer cannot challenge:
   * caught in a local render showing "Order total ₹22,401.80 / Already paid
   * −₹22,401.80 / Amount due SGD 109.00" — three numbers that do not reconcile
   * and two currencies. Rather than convert (we have no rate here and inventing
   * one on a payment page is worse), drop the context rows and let the amount
   * due stand alone.
   */
  const sameCurrency =
    !!order?.currency_code &&
    order.currency_code.toLowerCase() === pc.currency_code?.toLowerCase()

  const money = (v: number | null | undefined) =>
    v == null || !sameCurrency
      ? null
      : convertToLocale({
          amount: Number(v),
          currency_code: pc.currency_code,
        })

  const orderDate = order?.created_at
    ? new Date(order.created_at).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null

  const clientSecret = pc.payment_session?.client_secret ?? null
  // Only the secret is decidable on the server; whether Stripe.js loads is a
  // client fact, so PayCollectionWrapper owns that half.
  const canPay = Boolean(clientSecret)

  return (
    <Shell>
      <div>
        <Heading level="h1" className="text-2xl-semi mb-2">
          Complete your payment
        </Heading>
        <Text className="text-ui-fg-subtle">
          {order?.display_id
            ? `Order #${order.display_id}${
                orderDate ? ` · placed ${orderDate}` : ""
              }`
            : "Outstanding balance"}
        </Text>
      </div>

      {/* Say WHY money is owed before asking for it. A buyer who already paid
          once and then receives a link for more will assume a double charge
          unless the page accounts for both figures. */}
      <div className="rounded-lg border border-ui-border-base bg-ui-bg-subtle p-4">
        <Text className="txt-medium-plus text-ui-fg-base mb-1">
          This is an outstanding balance on your order
        </Text>
        <Text className="txt-small text-ui-fg-subtle">
          {order
            ? `Your order was updated after it was placed, which increased the total. Everything you have already paid is credited below — only the remaining ${amountLabel} is due now.`
            : `Only the remaining ${amountLabel} is due now. Anything already paid on this order is not charged again.`}
        </Text>
      </div>

      {order && order.items.length > 0 && (
        <div className="rounded-lg border border-ui-border-base divide-y divide-ui-border-base">
          <div className="px-4 py-3">
            <Text className="txt-small-plus text-ui-fg-base">
              What is in your order
            </Text>
          </div>
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

      <div className="flex flex-col gap-y-2 border-t border-ui-border-base pt-4">
        {money(order?.total) && (
          <div className="flex items-center justify-between">
            <Text className="txt-small text-ui-fg-subtle">Order total</Text>
            <Text className="txt-small text-ui-fg-subtle">
              {money(order?.total)}
            </Text>
          </div>
        )}
        {money(order?.paid_total) && (
          <div className="flex items-center justify-between">
            <Text className="txt-small text-ui-fg-subtle">Already paid</Text>
            <Text className="txt-small text-ui-fg-subtle">
              − {money(order?.paid_total)}
            </Text>
          </div>
        )}
        <div className="flex items-center justify-between border-t border-ui-border-base pt-2 mt-1">
          <Text className="txt-medium-plus text-ui-fg-base">Amount due now</Text>
          <Text className="txt-medium-plus text-ui-fg-base">{amountLabel}</Text>
        </div>
      </div>

      {canPay ? (
        /* Everything Stripe is client-side — see pay-collection-wrapper.tsx.
           A `loadStripe()` Promise cannot cross the RSC boundary, and when it
           silently fails to, the page renders a dead Pay button with no error. */
        <PayCollectionWrapper
          clientSecret={clientSecret as string}
          amountLabel={amountLabel}
        />
      ) : (
        <Text className="text-ui-fg-subtle">
          This payment link cannot be opened just now. Please reply to your order
          email and we will send a new one.
        </Text>
      )}
    </Shell>
  )
}
