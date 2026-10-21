import Image from "next/image"
import { Heading, Text } from "@medusajs/ui"

import type { PartnerProfile as Profile } from "@lib/data/partner-profile"
import imageLoader from "@lib/util/image-loader"
import LocalizedClientLink from "@modules/common/components/localized-client-link"

import { countryName, craftsOf, energyLines, roleLine, sinceLine } from "../lib"

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <Text className="text-small-semi text-ui-fg-muted uppercase tracking-wide">
    {children}
  </Text>
)

const Stat = ({ value, label }: { value: string; label: string }) => (
  <div className="flex flex-col gap-y-0.5 rounded-lg border border-ui-border-base px-4 py-3">
    <Text className="text-xl-semi text-ui-fg-base">{value}</Text>
    <Text className="text-small text-ui-fg-subtle">{label}</Text>
  </div>
)

/**
 * A partner's public page (#2444). Every block draws only when it has
 * something true to say: no photo, no gallery; nothing measured, no energy.
 */
export default function PartnerProfile({ partner }: { partner: Profile }) {
  const place = countryName(partner.country_code)
  const crafts = craftsOf(partner)
  const since = sinceLine(partner.making.making_since)
  const energy = energyLines(partner.energy)
  const photos = partner.capabilities.flatMap((c) =>
    c.images.map((img) => ({ ...img, title: c.title }))
  )
  const { pieces_made, pieces_last_90_days, samples_made } = partner.making

  return (
    <div className="content-container flex flex-col gap-y-12 py-10 small:py-16" data-testid="partner-profile">
      {/* Who */}
      <header className="flex flex-col gap-y-6">
        {partner.cover_image && (
          <div className="relative aspect-[3/1] w-full overflow-hidden rounded-xl bg-ui-bg-subtle">
            <Image
              src={partner.cover_image}
              alt=""
              fill
              priority
              sizes="100vw"
              loader={imageLoader}
              className="object-cover"
            />
          </div>
        )}
        <div className="flex items-center gap-x-4">
          {partner.logo ? (
            <Image
              src={partner.logo}
              alt={partner.name}
              width={64}
              height={64}
              loader={imageLoader}
              className="h-16 w-16 shrink-0 rounded-full border border-ui-border-base object-cover"
            />
          ) : (
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-ui-bg-subtle text-lg font-medium text-ui-fg-subtle">
              {partner.name.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="flex min-w-0 flex-col gap-y-1">
            <SectionLabel>The makers</SectionLabel>
            <Heading level="h1" className="text-2xl-semi text-ui-fg-base">
              {partner.name}
            </Heading>
            {(place || partner.tagline) && (
              <Text className="text-small text-ui-fg-subtle">
                {[partner.tagline, place].filter(Boolean).join(" · ")}
              </Text>
            )}
          </div>
        </div>
        {partner.about && (
          <Text className="max-w-2xl whitespace-pre-line text-medium leading-7 text-ui-fg-subtle">
            {partner.about}
          </Text>
        )}
        {crafts.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="Crafts">
            {crafts.map((c) => (
              <li
                key={c}
                className="rounded-full bg-ui-bg-subtle px-3 py-1 text-small-regular text-ui-fg-subtle"
              >
                {c}
              </li>
            ))}
          </ul>
        )}
      </header>

      {/* How much, who, what it took */}
      {(pieces_made > 0 || samples_made > 0 || partner.roles.length > 0 || partner.team_size) && (
        <section className="flex flex-col gap-y-4" data-testid="partner-making">
          <SectionLabel>Their work with us</SectionLabel>
          <div className="grid grid-cols-2 gap-3 small:grid-cols-4">
            {pieces_made > 0 && (
              <Stat value={pieces_made.toLocaleString("en-US")} label="pieces made" />
            )}
            {pieces_last_90_days > 0 && (
              <Stat
                value={pieces_last_90_days.toLocaleString("en-US")}
                label="in the last 3 months"
              />
            )}
            {samples_made > 0 && (
              <Stat value={samples_made.toLocaleString("en-US")} label="samples made" />
            )}
            {partner.team_size && (
              <Stat value={String(partner.team_size)} label="people in the team" />
            )}
          </div>
          {since && <Text className="text-small text-ui-fg-muted">{since}</Text>}
          {partner.roles.length > 0 && (
            <Text className="text-small-regular text-ui-fg-subtle" data-testid="partner-roles">
              The team: {partner.roles.map((r) => roleLine(r.role, r.count)).join(", ")}.
            </Text>
          )}
        </section>
      )}

      {energy.length > 0 && (
        <section className="flex flex-col gap-y-2" data-testid="partner-energy">
          <SectionLabel>What it took</SectionLabel>
          <Text className="text-small-regular text-ui-fg-subtle">
            Measured across their finished work with us: {energy.join(", ")}.
          </Text>
        </section>
      )}

      {/* What they make */}
      {partner.capabilities.length > 0 && (
        <section className="flex flex-col gap-y-4" data-testid="partner-capabilities">
          <SectionLabel>What they make</SectionLabel>
          {photos.length > 0 && (
            <div className="grid grid-cols-2 gap-3 small:grid-cols-4">
              {photos.slice(0, 8).map((p) => (
                <figure key={p.url} className="flex flex-col gap-y-1.5">
                  <div className="relative aspect-square overflow-hidden rounded-lg bg-ui-bg-subtle">
                    <Image
                      src={p.url}
                      alt={p.alt}
                      fill
                      sizes="(max-width: 640px) 50vw, 25vw"
                      loader={imageLoader}
                      className="object-cover"
                    />
                  </div>
                  <figcaption className="text-small text-ui-fg-subtle truncate">{p.title}</figcaption>
                </figure>
              ))}
            </div>
          )}
          <ul className="flex flex-col divide-y divide-ui-border-base border-y border-ui-border-base">
            {partner.capabilities.map((c) => (
              <li key={c.id} className="flex flex-col gap-y-0.5 py-3">
                <Text className="text-small-semi text-ui-fg-base">{c.title}</Text>
                {[c.technique, c.material, c.product_type].some(Boolean) && (
                  <Text className="text-small text-ui-fg-subtle">
                    {[c.technique, c.material, c.product_type].filter(Boolean).join(" · ")}
                  </Text>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Their pieces in this shop */}
      {partner.products.length > 0 && (
        <section className="flex flex-col gap-y-4" data-testid="partner-products">
          <SectionLabel>Their pieces in the shop</SectionLabel>
          <div className="grid grid-cols-2 gap-3 small:grid-cols-4">
            {partner.products.map((p) => (
              <LocalizedClientLink
                key={p.id}
                href={`/products/${p.handle}`}
                className="group flex flex-col gap-y-1.5"
              >
                <div className="relative aspect-square overflow-hidden rounded-lg bg-ui-bg-subtle">
                  {p.thumbnail && (
                    <Image
                      src={p.thumbnail}
                      alt={p.title}
                      fill
                      sizes="(max-width: 640px) 50vw, 25vw"
                      loader={imageLoader}
                      className="object-cover transition-transform group-hover:scale-105"
                    />
                  )}
                </div>
                <Text className="text-small-regular text-ui-fg-base truncate">{p.title}</Text>
              </LocalizedClientLink>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
