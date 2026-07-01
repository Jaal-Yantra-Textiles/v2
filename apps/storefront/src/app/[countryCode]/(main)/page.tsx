import { Metadata } from "next"
import { cookies } from "next/headers"

import FeaturedProducts from "@modules/home/components/featured-products"
import HolidaySection from "@modules/home/components/holidays"
import HeroSeenMarker, { HERO_SEEN_COOKIE } from "@modules/home/components/home-stage"
import PartnerShowcase from "@modules/home/components/partner-showcase"
import { listCollections } from "@lib/data/collections"
import { getRegion } from "@lib/data/regions"
import {
  buildLocalizedAlternates,
  getFirstProductImageFor,
} from "@lib/util/seo"
import { getBaseURL } from "@lib/util/env"
import { Suspense } from "react"

export async function generateMetadata(props: {
  params: Promise<{ countryCode: string }>
}): Promise<Metadata> {
  const { countryCode } = await props.params
  const alternates = await buildLocalizedAlternates(countryCode, "")

  // Display/OG title (also used for og:title + twitter:title below).
  // 51 chars — the root layout's "%s | Cici Label Store" template pushed
  // the homepage <title> to 65 chars, above the 50–60 target (audit #734 #4),
  // so the page title below uses `absolute` to bypass that suffix.
  const title = "Cici Label — Handmade, Locally Sourced Slow Fashion"
  const description =
    "Cici Label is a slow fashion brand focused on handmade, locally sourced, and ethically produced clothing. Shop handloom and natural-dyed garments."

  // Use the first catalogue product's thumbnail as the homepage OG image
  // so social shares of the landing page render a rich card rather than a
  // plain text snippet. Falls back to the static logo.
  const firstProductImage = await getFirstProductImageFor({ countryCode })
  const baseUrl = getBaseURL()
  const ogImage = firstProductImage ?? `${baseUrl}/logo.png`

  return {
    title: { absolute: title },
    description,
    alternates,
    openGraph: {
      title,
      description,
      type: "website",
      images: [{ url: ogImage, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
  }
}

export default async function Home(props: {
  params: Promise<{ countryCode: string }>
}) {
  const params = await props.params

  const { countryCode } = params

  const region = await getRegion(countryCode)

  const { collections } = await listCollections({
    fields: "id, handle, title",
  })

  if (!collections || !region) {
    return null
  }

  // Cookie-gated hero: first-time visitors see neither the hero nor the
  // holiday section — they land directly on the featured products below.
  // Returning visitors (cookie set) see the holiday section above products.
  // HeroSeenMarker sets the cookie on every client render so the gate
  // activates after the first page view.
  const cookieStore = await cookies()
  const heroSeen = cookieStore.has(HERO_SEEN_COOKIE)

  return (
    <>
      {heroSeen && <HolidaySection countryCode={countryCode} />}
      <HeroSeenMarker />
      <div id="shop" className="py-12">
        <ul className="flex flex-col gap-x-6">
          <FeaturedProducts collections={collections} region={region} />
        </ul>
      </div>
      <Suspense fallback={null}>
        <PartnerShowcase />
      </Suspense>
    </>
  )
}
