import { Metadata } from "next"

import { getPartnerShowcase } from "@lib/data/partner-showcase"
import { PartnerCard } from "@modules/home/components/partner-showcase/partner-card"

export const metadata: Metadata = {
  title: "Our Partners",
  description:
    "Browse the full network of artisan partners and discover their collections.",
}

export default async function PartnersPage() {
  const { partners, count } = await getPartnerShowcase()

  return (
    <div className="content-container py-12 small:py-16">
      <div className="mb-10 max-w-2xl">
        <h1 className="text-3xl font-medium tracking-tight small:text-4xl">
          Our Partners
        </h1>
        <p className="mt-3 text-neutral-500">
          {count > 0
            ? `Discover unique products from our network of ${count} artisan partner${count !== 1 ? "s" : ""}. Click any product to visit the partner's own storefront.`
            : "We're onboarding new artisan partners — check back soon."}
        </p>
      </div>

      {partners.length > 0 ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {partners.map((partner) => (
            <PartnerCard key={partner.id} partner={partner} />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-6 py-16 text-center text-sm text-neutral-500">
          No partners to show yet.
        </div>
      )}
    </div>
  )
}
