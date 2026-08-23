import { Heading, Text } from "@medusajs/ui"

import type { Provenance, QuoteProducer } from "@lib/data/quotes"

/**
 * The maker, in one section (#1428, #1439 S9).
 *
 * ## Why "Produced by" and "About" are now one block
 *
 * They were two, thirty lines apart, and both answered "who is this workshop".
 * A buyer read the name near the top, then a table of the same workshop's facts
 * below the prices, and had to hold the two together themselves. Merged, the
 * credit line becomes the heading of the facts that support it — which is what
 * makes it persuasive rather than a disclosure.
 *
 * ## What renders, and what stays the backend's call
 *
 * 🔑 `producer: null` means SAY NOTHING about who is producing — on the
 * partner's own domain the partner IS the seller, and naming them under their
 * own logo is noise. But `provenance` can still exist there, and the maker's
 * facts are worth showing on any storefront. So the two are independent: the
 * "Produced by" framing needs a producer, the facts need only provenance, and
 * the section renders whatever it has.
 *
 * 🔴 No fallbacks, ever. `buildProvenance` omits a row whose fact is absent
 * rather than em-dashing it, because an em-dash reads as "we know this and it
 * is nothing" — a different and wrong claim about a supplier. A sparse partner
 * shows fewer rows; it never shows a grid of blanks.
 *
 * The name links to the partner's OWN shop, because that is where the order
 * goes whichever storefront took it. `url` is null when there is no verified
 * custom domain and no provisioned subdomain, and then the name is plain text:
 * an unverified domain is a host we do not control.
 */
const REGION_NAMES =
  typeof Intl !== "undefined" && (Intl as any).DisplayNames
    ? new (Intl as any).DisplayNames(["en"], { type: "region" })
    : null

const countryName = (code: string | null | undefined): string | null => {
  if (!code) return null
  try {
    const name = REGION_NAMES?.of(code.toUpperCase()) ?? null
    // An unrecognised code falls through to nothing rather than printing "IN".
    return name && name !== code.toUpperCase() ? name : null
  } catch {
    return null
  }
}

const QuoteMakerSection = ({
  producer,
  provenance,
}: {
  producer: QuoteProducer | null
  provenance: Provenance | null
}) => {
  const rows = provenance?.rows ?? []
  const story = producer?.story ?? provenance?.maker_story ?? null
  const tags = producer?.tags ?? []
  const name = producer?.name ?? provenance?.maker_name ?? null

  // Nothing true to say. A heading over an empty card is worse than no card.
  if (!name && !rows.length && !story) return null

  const country = countryName(producer?.country_code)

  return (
    <section className="mt-6 rounded-lg border border-ui-border-base p-5 small:p-6">
      <div className="flex flex-col gap-x-4 gap-y-4 small:flex-row small:items-start">
        {producer?.logo ? (
          <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full bg-ui-bg-subtle">
            {/* 🔴 A plain <img>, deliberately, where the rest of this app uses
                next/image. A partner logo can be on ANY host they uploaded it
                to, and next/image hard-errors on a hostname missing from
                `remotePatterns` — a 48px avatar is not worth a 500 on a
                buyer's quote page. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={producer.logo}
              alt={producer.name ?? "Maker"}
              width={48}
              height={48}
              loading="lazy"
              className="h-full w-full object-cover object-center"
            />
          </div>
        ) : null}

        <div className="min-w-0 flex-1">
          {producer ? (
            <Text className="txt-small-plus uppercase tracking-wide text-ui-fg-subtle">
              Produced by
            </Text>
          ) : null}

          <Heading level="h2" className="text-xl-semi text-ui-fg-base">
            {producer?.url ? (
              <a
                href={producer.url}
                target="_blank"
                // A quote link is a credential in the URL. `noopener noreferrer`
                // stops the opened shop reaching back through `window.opener`
                // or reading this page's token off the referrer.
                rel="noopener noreferrer"
                className="text-ui-fg-interactive hover:text-ui-fg-interactive-hover"
              >
                {name}
              </a>
            ) : (
              name ?? "About this maker"
            )}
          </Heading>

          {country ? (
            <Text className="txt-small text-ui-fg-subtle">{country}</Text>
          ) : null}

          {tags.length ? (
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <li
                  key={tag}
                  className="rounded-full border border-ui-border-base bg-ui-bg-subtle px-2.5 py-1 txt-small text-ui-fg-subtle"
                >
                  {tag}
                </li>
              ))}
            </ul>
          ) : null}

          {story ? (
            <Text className="txt-medium text-ui-fg-subtle mt-4 whitespace-pre-line">
              {story}
            </Text>
          ) : null}

          {producer ? (
            // Founder, 21 Aug: the order goes to them regardless of which
            // storefront took it. Saying so turns the credit from a disclosure
            // into what it actually is — the reason to buy.
            <Text className="txt-small text-ui-fg-muted mt-3">
              Your order is made and dispatched by this workshop.
            </Text>
          ) : null}
        </div>
      </div>

      {rows.length ? (
        <dl className="mt-5 grid grid-cols-1 gap-x-8 gap-y-3 small:grid-cols-2">
          {rows.map((row) => (
            <div
              key={row.key}
              className="flex flex-col border-t border-ui-border-base pt-3"
            >
              <dt className="txt-small text-ui-fg-muted uppercase tracking-wide">
                {row.label}
              </dt>
              <dd className="txt-medium text-ui-fg-base">{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  )
}

export default QuoteMakerSection
