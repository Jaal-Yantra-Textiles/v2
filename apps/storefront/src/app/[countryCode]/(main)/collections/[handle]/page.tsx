import { Metadata } from "next"
import { notFound } from "next/navigation"

import { getCollectionByHandle } from "@lib/data/collections"
import {
  buildLocalizedAlternates,
  getFirstProductImageFor,
} from "@lib/util/seo"
import { StoreCollection } from "@medusajs/types"
import CollectionTemplate from "@modules/collections/templates"
import { SortOptions } from "@modules/store/components/refinement-list/sort-products"

type Props = {
  params: Promise<{ handle: string; countryCode: string }>
  searchParams: Promise<{
    page?: string
    sortBy?: SortOptions
  }>
}

export const PRODUCT_LIMIT = 12

// No generateStaticParams, on purpose. These pages read the visitor's region
// and cart cookies, so they always render on demand (ƒ). Prebuilding every
// country × handle (~9,500 pages) added 10+ minutes to each Vercel build for
// pages that were never served from the prerender. And `return []` is NOT the
// same: it marks the route static, and the cookie read then throws
// DYNAMIC_SERVER_USAGE (500).

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params
  const collection = await getCollectionByHandle(params.handle)

  if (!collection) {
    notFound()
  }

  const description = `Shop the ${collection.title} collection at Cici Label Store. Handmade, ethically sourced fashion.`

  const alternates = await buildLocalizedAlternates(
    params.countryCode,
    `collections/${params.handle}`
  )

  const metaOgImage = (collection as any).metadata?.og_image
  const firstProductImage =
    metaOgImage ||
    (collection as any).products?.[0]?.thumbnail ||
    (await getFirstProductImageFor({
      countryCode: params.countryCode,
      collectionId: collection.id,
    })) ||
    undefined

  const ogImages = firstProductImage
    ? [{ url: firstProductImage, alt: collection.title }]
    : undefined

  return {
    title: collection.title,
    description,
    alternates,
    openGraph: {
      title: collection.title,
      description,
      type: "website",
      ...(ogImages ? { images: ogImages } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: collection.title,
      description,
      ...(firstProductImage ? { images: [firstProductImage] } : {}),
    },
  } as Metadata
}

export default async function CollectionPage(props: Props) {
  const searchParams = await props.searchParams
  const params = await props.params
  const { sortBy, page } = searchParams

  const collection = await getCollectionByHandle(params.handle).then(
    (collection: StoreCollection) => collection
  )

  if (!collection) {
    notFound()
  }

  return (
    <CollectionTemplate
      collection={collection}
      page={page}
      sortBy={sortBy}
      countryCode={params.countryCode}
    />
  )
}
