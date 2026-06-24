
import React, { Suspense } from "react"

import ImageGallery from "@modules/products/components/image-gallery"
import ProductActions from "@modules/products/components/product-actions"
import ProductOnboardingCta from "@modules/products/components/product-onboarding-cta"
import ProductTabs from "@modules/products/components/product-tabs"
import RelatedProducts from "@modules/products/components/related-products"
import ProductInfo from "@modules/products/templates/product-info"
import { DesignInfo } from "@modules/products/templates/design-info"
import SkeletonRelatedProducts from "@modules/skeletons/templates/skeleton-related-products"
import { notFound } from "next/navigation"
import ProductActionsWrapper from "./product-actions-wrapper"
import SizeGuide from "@modules/products/components/size-guide"
import { HttpTypes } from "@medusajs/types"
import { Text } from "@medusajs/ui"
import { StoreDesign } from "../../../types/product-design"
import { buildProductJsonLd } from "./product-jsonld"
import { buildBreadcrumbJsonLd } from "@lib/util/breadcrumb-jsonld"
import { getProductionStory } from "@lib/data/designs"
import { summarizeProductionJourney } from "@modules/products/components/production-story/lib"

type ProductTemplateProps = {
  product: HttpTypes.StoreProduct & { designs?: StoreDesign[] } // Extend product type to include designs
  region: HttpTypes.StoreRegion
  countryCode: string
  images: HttpTypes.StoreProductImage[]
}

const calculateDesignScore = (design: StoreDesign | undefined) => {
  if (!design) {
    return { score: 0, maxScore: 4 }
  }

  let score = 1 // Base score for having a design
  if (design.tasks && design.tasks.length > 0) {
    score++
  }
  if (design.partners && design.partners.length > 0) {
    score++
  }
  if (design.inventory_items && design.inventory_items.length > 0) {
    score++
  }

  return { score, maxScore: 4 }
}

const ProductTemplate = async ({
  product,
  region,
  countryCode,
  images,
}: ProductTemplateProps) => {
  if (!product || !product.id) {
    return notFound()
  }

  const design = product.designs?.[0]
  const designScore = calculateDesignScore(design)

  // v2 production story (money-free). Powers the "Crafted by" tab + the clean
  // Activity Timeline in DesignInfo. Empty/absent for v1-only designs, which
  // then keep their task-based timeline.
  const story = design?.id ? await getProductionStory(design.id) : null
  const activityTimeline =
    summarizeProductionJourney(story?.runs)?.steps ?? undefined

  const jsonLd = buildProductJsonLd(product, { countryCode })

  const breadcrumbLd = buildBreadcrumbJsonLd([
    { name: "Home", path: `/${countryCode}` },
    ...(product.collection
      ? [
          {
            name: product.collection.title,
            path: `/${countryCode}/collections/${product.collection.handle}`,
          },
        ]
      : []),
    {
      name: product.title || "Product",
      path: `/${countryCode}/products/${product.handle}`,
    },
  ])

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />
      <div
        className="content-container flex flex-col small:flex-row small:items-start py-12 relative gap-x-12 small:gap-x-24"
        data-testid="product-container"
      >
        <div className="flex flex-col small:sticky small:top-48 small:py-0 small:max-w-[300px] w-full py-8 gap-y-6">
          <ProductInfo product={product} />
          <div className="hidden small:block">
            <DesignInfo
              design={design}
              designScore={designScore}
              activityTimeline={activityTimeline}
            />
          </div>
          <div className="hidden small:block">
            <ProductTabs product={product} story={story} />
          </div>
        </div>
        <div className="block w-full relative">
          <ImageGallery images={images} />
        </div>
        <div className="w-full py-8 small:hidden">
          <DesignInfo
            design={design}
            designScore={designScore}
            activityTimeline={activityTimeline}
          />
          <div className="mt-8">
            <ProductTabs product={product} story={story} />
          </div>
        </div>

        <div className="flex flex-col small:sticky small:top-48 small:py-0 small:max-w-[300px] w-full py-8 gap-y-12">
          <ProductOnboardingCta />

          <Suspense
            fallback={
              <ProductActions product={product} region={region} />
            }
          >

            <ProductActionsWrapper id={product.id} region={region} />
            <div className="mt-4 flex items-center gap-x-2">
              <Text className="txt-medium">Size Guide</Text>
              <SizeGuide />
            </div>
          </Suspense>

        </div>
      </div>
      <div
        className="content-container my-16 small:my-32"
        data-testid="related-products-container"
      >
        <Suspense fallback={<SkeletonRelatedProducts />}>
          <RelatedProducts product={product} countryCode={countryCode} />
        </Suspense>
      </div>
    </>
  )
}

export default ProductTemplate
