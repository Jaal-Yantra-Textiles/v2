import { Metadata } from "next"
import { notFound } from "next/navigation"

import { getCategoryByHandle, listCategories } from "@lib/data/categories"
import { listRegions } from "@lib/data/regions"
import {
  buildLocalizedAlternates,
  cleanMetaDescription,
  getFirstProductImageFor,
} from "@lib/util/seo"
import { StoreRegion } from "@medusajs/types"
import CategoryTemplate from "@modules/categories/templates"
import { SortOptions } from "@modules/store/components/refinement-list/sort-products"

type Props = {
  params: Promise<{ category: string[]; countryCode: string }>
  searchParams: Promise<{
    sortBy?: SortOptions
    page?: string
  }>
}

export async function generateStaticParams() {
  const product_categories = await listCategories()

  if (!product_categories) {
    return []
  }

  const countryCodes = await listRegions().then((regions: StoreRegion[]) =>
    regions?.map((r) => r.countries?.map((c) => c.iso_2)).flat()
  )

  const categoryHandles = product_categories.map(
    (category: any) => category.handle
  )

  const staticParams = countryCodes
    ?.map((countryCode: string | undefined) =>
      categoryHandles.map((handle: any) => ({
        countryCode,
        category: [handle],
      }))
    )
    .flat()

  return staticParams
}

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
