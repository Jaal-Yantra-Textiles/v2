import { Metadata } from "next"
import { cookies } from "next/headers"

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
        <label className="sr-only" htmlFor="coming-soon-search">
          Search products
        </label>
        <div className="relative">
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400 sm:left-5 sm:h-5 sm:w-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            id="coming-soon-search"
            type="text"
            disabled
            placeholder="Search soon — describe what you want"
            className="w-full rounded-full border border-dashed border-neutral-300 bg-neutral-100 pl-11 pr-5 py-2.5 text-sm text-neutral-500 placeholder:text-neutral-500 sm:pl-12 sm:pr-6 sm:py-3 sm:text-base"
          />
        </div>
        <p className="mt-2 text-center text-xs text-neutral-500 sm:text-sm">
          Powerful natural-language discovery coming soon.
        </p>
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
