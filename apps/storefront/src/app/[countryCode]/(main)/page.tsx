import { Metadata } from "next"

import FeaturedProducts from "@modules/home/components/featured-products"
import Genesis from "@modules/home/components/genesis"
import Hero from "@modules/home/components/hero"
import HolidaySection from "@modules/home/components/holidays"
import { getHomeMedia } from "@modules/home/components/home-media"
import HomeMediaStrip from "@modules/home/components/media-strip"
import Provenance from "@modules/home/components/provenance"
import { listCollections } from "@lib/data/collections"
import { getRegion } from "@lib/data/regions"
import {
  buildLocalizedAlternates,
  getFirstProductImageFor,
} from "@lib/util/seo"
import { getBaseURL } from "@lib/util/env"

const LATEST_COLLECTION_HANDLE = "latest"

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

  // "Latest" leads the home page; the rest keep the order the API returns.
  // Without this the rail order was whatever the database happened to return.
  const orderedCollections = [
    ...collections.filter((c) => c.handle === LATEST_COLLECTION_HANDLE),
    ...collections.filter((c) => c.handle !== LATEST_COLLECTION_HANDLE),
  ]

  // The holiday section sits between the collection rails rather than under
  // the painting hero, so the first rail stays above the fold. The media
  // strip follows it, then the remaining rails. Always rendered — no
  // cookie/localStorage gate.
  const [leadCollection, ...remainingCollections] = orderedCollections

  // One draw from the public media API: the first image is the hero, the
  // next four fill the media grid. Sharing the batch is what keeps the two
  // from ever showing the same painting twice on a page.
  const { hero: heroImage, grid: gridImages } = await getHomeMedia()

  return (
    <>
      <Hero image={heroImage} />
      <section className="w-full bg-[#f7f4ef] px-6 pt-20 pb-4 small:pt-28">
        <h2 className="mx-auto max-w-5xl text-center font-serif text-balance text-3xl tracking-tight text-neutral-900 small:text-5xl">
          Elevate Your Wardrobe with Unmatched Comfort &amp; Style
        </h2>
      </section>
      <div id="shop" className="py-12 bg-[#f7f4ef]">
        <ul className="flex flex-col gap-x-6">
          {leadCollection && (
            <FeaturedProducts
              collections={[leadCollection]}
              region={region}
            />
          )}
          <li>
            <HolidaySection countryCode={countryCode} />
          </li>
          <li>
            <HomeMediaStrip images={gridImages} />
          </li>
          {remainingCollections.length > 0 && (
            <FeaturedProducts
              collections={remainingCollections}
              region={region}
            />
          )}
        </ul>
      </div>
      <Genesis />
      <Provenance />
    </>
  )
}
