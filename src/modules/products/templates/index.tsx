
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
import { Badge, IconBadge, Text, Tooltip, TooltipProvider } from "@medusajs/ui"
import Link from "next/link"
import { StoreDesign } from "../../../types/product-design"
import { MobileDesignScore } from "./mobile-design-score"

type ProductTemplateProps = {
  product: HttpTypes.StoreProduct & { designs?: StoreDesign[] } // Extend product type to include designs
  region: HttpTypes.StoreRegion
  countryCode: string
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

const ProductTemplate: React.FC<ProductTemplateProps> = ({
  product,
  region,
  countryCode,
}) => {
  if (!product || !product.id) {
    return notFound()
  }

  const design = product.designs?.[0]
  const designScore = calculateDesignScore(design)

  return (
    <>
      <div
        className="content-container flex flex-col small:flex-row small:items-start py-6 relative"
        data-testid="product-container"
      >
        <div className="flex flex-col small:sticky small:top-48 small:py-0 small:max-w-[300px] w-full py-8 gap-y-6">
          <ProductInfo product={product} />
          <div>
            <div className="flex items-center gap-x-2 mb-4">
              <Text size="base">Design Info</Text>
              {/* Desktop/large screens: keep tooltip */}
              <div className="hidden small:flex">
                <TooltipProvider>
                  <Tooltip
                    content={
                      <div className="flex flex-col gap-y-2 txt-compact-small p-2 max-w-xs">
                        <Text className="txt-compact-small-plus font-semibold">
                          What is a Design Score?
                        </Text>
                        <Text>
                          The score indicates the completeness of the design
                          information. A higher score means more details like
                          tasks, partners, and raw materials are available.
                        </Text>
                        <Link
                          href="/what-is-a-design-score"
                          className="text-ui-fg-interactive hover:underline"
                        >
                          Learn more
                        </Link>
                      </div>
                    }
                  >
                    <div className="flex items-center gap-x-1 cursor-pointer">
                      <Badge color="green">
                        Score: {designScore.score}/{designScore.maxScore}
                      </Badge>
                      <IconBadge>
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="feather feather-info"
                        >
                          <circle cx="12" cy="12" r="10"></circle>
                          <line x1="12" y1="16" x2="12" y2="12"></line>
                          <line x1="12" y1="8" x2="12.01" y2="8"></line>
                        </svg>
                      </IconBadge>
                    </div>
                  </Tooltip>
                </TooltipProvider>
              </div>

              {/* Mobile: Popover-based design score */}
              <MobileDesignScore score={designScore.score} maxScore={designScore.maxScore} />
            </div>
            
            <DesignInfo design={design} />
          </div>
          <ProductTabs product={product} />
        </div>
        <div className="block w-full relative">
          <ImageGallery images={product?.images || []} />
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
