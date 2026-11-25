import { Metadata } from "next"
import { notFound } from "next/navigation"
import { listProducts } from "@lib/data/products"
import { getRegion } from "@lib/data/regions"
import { buildLocalizedAlternates, cleanMetaDescription } from "@lib/util/seo"
import ProductTemplate from "@modules/products/templates"
import { HttpTypes } from "@medusajs/types"

// Revalidate product pages every hour so newly published products become
// accessible without requiring a full redeploy.
export const revalidate = 3600

type Props = {
  params: Promise<{ countryCode: string; handle: string }>
  searchParams: Promise<{ v_id?: string }>
}

// No generateStaticParams, on purpose. These pages read the visitor's region
// and cart cookies, so they always render on demand (ƒ). Prebuilding every
// country × handle (~9,500 pages) added 10+ minutes to each Vercel build for
// pages that were never served from the prerender. And `return []` is NOT the
// same: it marks the route static, and the cookie read then throws
// DYNAMIC_SERVER_USAGE (500).

function getImagesForVariant(
  product: HttpTypes.StoreProduct,
  selectedVariantId?: string
): HttpTypes.StoreProductImage[] {
  const productImages = product.images ?? []

  if (!selectedVariantId || !product.variants) {
    return productImages
  }

  const variant = product.variants.find((v) => v.id === selectedVariantId)
  const variantImages = variant?.images ?? []
  if (!variant || variantImages.length === 0) {
    return productImages
  }

  const imageIdsMap = new Map(variantImages.map((i) => [i.id, true]))
  return productImages.filter((i) => imageIdsMap.has(i.id))
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params
  const { handle } = params
  const region = await getRegion(params.countryCode)

  if (!region) {
    notFound()
  }

  const product = await listProducts({
    countryCode: params.countryCode,
    queryParams: { handle },
  }).then(({ response }) => response.products[0])

  if (!product) {
    notFound()
  }

  const description = product.description
    ? cleanMetaDescription(product.description)
    : `Shop ${product.title} at Cici Label Store. Handmade, ethically sourced fashion.`

  const alternates = await buildLocalizedAlternates(
    params.countryCode,
    `products/${params.handle}`
  )

  return {
    title: product.title,
    description,
    alternates,
    openGraph: {
      title: product.title,
      description,
      type: "website",
      images: product.thumbnail ? [{ url: product.thumbnail, alt: product.title }] : [],
    },
    twitter: {
      card: "summary_large_image",
      title: product.title,
      description,
      images: product.thumbnail ? [product.thumbnail] : [],
    },
  }
}

export default async function ProductPage(props: Props) {
  const params = await props.params
  const region = await getRegion(params.countryCode)
  const searchParams = await props.searchParams

  const selectedVariantId = searchParams.v_id

  if (!region) {
    notFound()
  }

  const pricedProduct = await listProducts({
    countryCode: params.countryCode,
    queryParams: { handle: params.handle },
  }).then(({ response }) => response.products[0])

  /**
   * 🔴 The guard goes FIRST. `getImagesForVariant` dereferences the product,
   * so calling it above this check turned every genuine miss — a handle that
   * does not exist, or one the publishable key's sales channel cannot see —
   * into `TypeError: Cannot read properties of undefined (reading 'images')`
   * and a **500** where a 404 was intended. The page was already deciding to
   * notFound(); it simply crashed on the way there.
   */
  if (!pricedProduct) {
    notFound()
  }

  const images = getImagesForVariant(pricedProduct, selectedVariantId)

  return (
    <ProductTemplate
      product={pricedProduct}
      region={region}
      countryCode={params.countryCode}
      images={images}
    />
  )
}
