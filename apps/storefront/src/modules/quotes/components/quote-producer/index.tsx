import { Text } from "@medusajs/ui"

import type { QuoteProducer } from "@lib/data/quotes"

/**
 * "Who is producing this" (#1428).
 *
 * On a handloom product this is a selling point, not a disclosure obligation —
 * a buyer comparing suppliers wants to know whose hands make the cloth.
 *
 * 🔑 Whether it renders at all is the BACKEND's decision. On the partner's own
 * domain the partner IS the seller, so naming them again under their own logo
 * is noise; the backend returns `producer: null` there. A null here means "say
 * nothing", never "unknown producer" — so this component renders nothing at
 * all rather than an empty band with a heading.
 *
 * The name links to the partner's OWN shop, because that is where the order
 * goes whichever storefront took it — so the link is a statement of fact, not
 * a referral. `url` is null when the partner has no verified custom domain and
 * no provisioned subdomain, and then the name is plain text: an unverified
 * domain is a host we do not control and must not be handed to a buyer.
 */
const REGION_NAMES =
  typeof Intl !== "undefined" && (Intl as any).DisplayNames
    ? new (Intl as any).DisplayNames(["en"], { type: "region" })
    : null

const QuoteProducerBand = ({ producer }: { producer: QuoteProducer }) => {
  if (!producer.name) return null

  // An ISO code is a database value, not something to show a buyer. An
  // unrecognised code falls through to nothing rather than printing "IN".
  let country: string | null = null
  if (producer.country_code) {
    try {
      country = REGION_NAMES?.of(producer.country_code.toUpperCase()) ?? null
      if (country === producer.country_code.toUpperCase()) country = null
    } catch {
      country = null
    }
  }

  return (
    <div className="mt-6 flex items-center gap-x-4 rounded-lg border border-ui-border-base p-5">
      {producer.logo ? (
        <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full bg-ui-bg-subtle">
          {/* 🔴 A plain <img>, deliberately, where the rest of this app uses
              next/image. A partner logo can be on ANY host they uploaded it
              to, and next/image hard-errors the request on a hostname missing
              from `remotePatterns` — a 48px avatar is not worth a 500 on a
              buyer's quote page. Catalog images stay on next/image because
              they come from the bucket the whole storefront already renders. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={producer.logo}
            alt={producer.name}
            width={48}
            height={48}
            loading="lazy"
            className="h-full w-full object-cover object-center"
          />
        </div>
      ) : null}
      <div className="flex flex-col">
        <Text className="txt-small-plus uppercase tracking-wide text-ui-fg-subtle">
          Produced by
        </Text>
        <Text className="txt-medium-plus text-ui-fg-base">
          {producer.url ? (
            <a
              href={producer.url}
              target="_blank"
              // A quote link is a credential in the URL. `noopener noreferrer`
              // stops the opened shop from reaching back through
              // `window.opener` or reading this page's token off the referrer.
              rel="noopener noreferrer"
              className="hover:text-ui-fg-interactive-hover text-ui-fg-interactive"
            >
              {producer.name}
            </a>
          ) : (
            producer.name
          )}
          {producer.is_verified ? (
            <span
              className="ml-2 align-middle txt-small text-ui-fg-subtle"
              title="Verified partner"
            >
              Verified
            </span>
          ) : null}
        </Text>
        {country ? (
          <Text className="txt-small text-ui-fg-subtle">{country}</Text>
        ) : null}
        {/* Founder, 21 Aug: the order goes to them regardless of which
            storefront took it. Saying so turns the credit from a disclosure
            into what it actually is — the reason to buy. */}
        <Text className="txt-small text-ui-fg-muted mt-1">
          Your order is made and dispatched by this workshop.
        </Text>
      </div>
    </div>
  )
}

export default QuoteProducerBand
