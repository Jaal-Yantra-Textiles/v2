import { getPartnerShowcase } from "@lib/data/partner-showcase"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { PartnerCard } from "./partner-card"

const HOME_PARTNER_LIMIT = 4

export default async function PartnerShowcase() {
  const { partners, count } = await getPartnerShowcase()

  if (!partners.length) return null

  const displayed = partners.slice(0, HOME_PARTNER_LIMIT)
  const hasMore = count > displayed.length

  return (
    <div className="content-container py-16">
      <div className="mb-8 text-center">
        <h2 className="text-2xl font-medium tracking-tight">
          Shop from Our Partners
        </h2>
        <p className="mt-2 text-neutral-500">
          Discover unique products from our network of artisan partners
        </p>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {displayed.map((partner) => (
          <PartnerCard key={partner.id} partner={partner} />
        ))}
      </div>
      {hasMore && (
        <div className="mt-8 text-center">
          <LocalizedClientLink
            href="/partners"
            className="inline-flex items-center gap-x-2 rounded-full border border-neutral-200 px-5 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 transition-colors"
          >
            View all {count} partners
            <span aria-hidden>→</span>
          </LocalizedClientLink>
        </div>
      )}
    </div>
  )
}
