import { Metadata } from "next"
import { cookies } from "next/headers"

import AiSearch from "@modules/home/components/ai-search"
import FeaturedProducts from "@modules/home/components/featured-products"
import Hero from "@modules/home/components/hero"
import HolidaySection from "@modules/home/components/holidays"
import HeroSeenMarker, { HERO_SEEN_COOKIE } from "@modules/home/components/home-stage"
import PartnerShowcase from "@modules/home/components/partner-showcase"
import ScrollStage from "@modules/home/components/scroll-stage"
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

  const title = "Cici Label - Handmade, Locally Sourced Fashion"
  const description =
    "Cici Label is a slow fashion brand focused on handmade, locally sourced, and ethically produced clothing. Shop handloom and natural-dyed garments."

  // Use the first catalogue product's thumbnail as the homepage OG image
  // so social shares of the landing page render a rich card rather than a
  // plain text snippet. Falls back to the static logo.
  const firstProductImage = await getFirstProductImageFor({ countryCode })
  const baseUrl = getBaseURL()
  const ogImage = firstProductImage ?? `${baseUrl}/logo.png`

  return {
    title,
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

  // Cookie-gated hero: first-time visitors see the full scroll-driven
  // ScrollStage (hero pinned, holiday rises over it). Returning visitors
  // land directly on the holiday section. HeroSeenMarker (a tiny client
  // component below) sets the cookie on every render, so once a visitor
  // has hit any page their next request reads the cookie and skips the
  // hero. Branching on the server keeps Hero's listPublicMedia call out
  // of the hot path for returning visitors and avoids hydration flicker.
  const cookieStore = await cookies()
  const heroSeen = cookieStore.has(HERO_SEEN_COOKIE)
  const holidaySection = <HolidaySection countryCode={countryCode} />

  return (
    <>
      {heroSeen ? (
        holidaySection
      ) : (
        <ScrollStage hero={<Hero />} holiday={holidaySection} />
      )}
      <HeroSeenMarker />
      <div className="mx-auto mt-8 w-full max-w-3xl px-4 sm:mt-10 sm:px-6">
        <AiSearch />
      </div>
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
