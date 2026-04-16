import { Metadata } from "next"

import FeaturedProducts from "@modules/home/components/featured-products"
import Hero from "@modules/home/components/hero"
import HolidaySection from "@modules/home/components/holidays"
import PartnerShowcase from "@modules/home/components/partner-showcase"
import ScrollStage from "@modules/home/components/scroll-stage"
import { listCollections } from "@lib/data/collections"
import { getRegion } from "@lib/data/regions"
import { Suspense } from "react"

export const metadata: Metadata = {
  title: "Cici Label - Handmade, Locally Sourced Fashion",
  description:
    "Cici Label is a slow fashion brand focused on handmade, locally sourced, and ethically produced clothing. Shop handloom and natural-dyed garments.",
  openGraph: {
    title: "Cici Label - Handmade, Locally Sourced Fashion",
    description:
      "Slow fashion brand focused on handmade, locally sourced, and ethically produced clothing.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Cici Label - Handmade, Locally Sourced Fashion",
    description:
      "Slow fashion brand focused on handmade, locally sourced, and ethically produced clothing.",
  },
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

  return (
    <>
      <ScrollStage
        hero={<Hero />}
        holiday={<HolidaySection countryCode={countryCode} />}
      />
      <div className="mx-auto mt-10 w-full max-w-3xl px-4 sm:px-0">
        <label className="sr-only" htmlFor="coming-soon-search">
          Coming soon search
        </label>
        <input
          id="coming-soon-search"
          type="text"
          disabled
          placeholder="Soon you can search by entering list of ideas your favorite product coming soon"
          className="w-full rounded-full border border-dashed border-neutral-300 bg-neutral-100 px-6 py-3 text-base text-neutral-500 placeholder:text-neutral-500"
        />
        <p className="mt-2 text-center text-sm text-neutral-500">
          We&apos;re building powerful discovery tools—stay tuned!
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
