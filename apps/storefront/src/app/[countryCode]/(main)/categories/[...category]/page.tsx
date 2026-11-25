import { Metadata } from "next"
import { notFound } from "next/navigation"

import { getCategoryByHandle } from "@lib/data/categories"
import {
  buildLocalizedAlternates,
  cleanMetaDescription,
  getFirstProductImageFor,
} from "@lib/util/seo"
import CategoryTemplate from "@modules/categories/templates"
import { SortOptions } from "@modules/store/components/refinement-list/sort-products"

type Props = {
  params: Promise<{ category: string[]; countryCode: string }>
  searchParams: Promise<{
    sortBy?: SortOptions
    page?: string
  }>
}

// No generateStaticParams, on purpose. These pages read the visitor's region
// and cart cookies, so they always render on demand (ƒ). Prebuilding every
// country × handle (~9,500 pages) added 10+ minutes to each Vercel build for
// pages that were never served from the prerender. And `return []` is NOT the
// same: it marks the route static, and the cookie read then throws
// DYNAMIC_SERVER_USAGE (500).

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params
  try {
    const productCategory = await getCategoryByHandle(params.category)

    const description = productCategory.description
      ? cleanMetaDescription(productCategory.description)
      : `Shop ${productCategory.name} at Cici Label Store. Handmade, ethically sourced fashion.`

    const categoryPath = `categories/${params.category.join("/")}`
    const alternates = await buildLocalizedAlternates(
      params.countryCode,
      categoryPath
    )

    // Prefer a category banner image if available, otherwise fetch the
    // thumbnail of the first product in the category — gives Google and
    // social previews something richer than a plain text card.
    const metaOgImage = (productCategory as any).metadata?.og_image
    const firstProductImage =
      metaOgImage ||
      productCategory.products?.[0]?.thumbnail ||
      (await getFirstProductImageFor({
        countryCode: params.countryCode,
        categoryId: productCategory.id,
      })) ||
      undefined

    const ogImages = firstProductImage
      ? [{ url: firstProductImage, alt: productCategory.name }]
      : undefined

    return {
      title: productCategory.name,
      description,
      alternates,
      openGraph: {
        title: productCategory.name,
        description,
        type: "website",
        ...(ogImages ? { images: ogImages } : {}),
      },
      twitter: {
        card: "summary_large_image",
        title: productCategory.name,
        description,
        ...(firstProductImage ? { images: [firstProductImage] } : {}),
      },
    }
  } catch (error) {
    notFound()
  }
}

export default async function CategoryPage(props: Props) {
  const searchParams = await props.searchParams
  const params = await props.params
  const { sortBy, page } = searchParams

  const productCategory = await getCategoryByHandle(params.category)

  if (!productCategory) {
    notFound()
  }

  return (
    <CategoryTemplate
      category={productCategory}
      sortBy={sortBy}
      page={page}
      countryCode={params.countryCode}
    />
  )
}
