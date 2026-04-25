import { HttpTypes } from "@medusajs/types"
import { Heading } from "@medusajs/ui"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import FadeIn from "@modules/common/components/fade-in"
import ProductDescription from "@modules/products/components/product-description"
type ProductInfoProps = {
  product: HttpTypes.StoreProduct
}

const ProductInfo = ({ product }: ProductInfoProps) => {
  return (
    <div id="product-info">
      <div className="flex flex-col gap-y-4 lg:max-w-[500px] mx-auto">
        {product.collection && (
          <FadeIn delay={0.1}>
            <LocalizedClientLink
              href={`/collections/${product.collection.handle}`}
              className="text-medium text-ui-fg-muted hover:text-ui-fg-base transition-colors"
            >
              {product.collection.title}
            </LocalizedClientLink>
          </FadeIn>
        )}
        <FadeIn delay={0.2}>
          <Heading
            level="h1"
            className="text-4xl leading-[1.1] font-semibold text-ui-fg-base tracking-tight"
            data-testid="product-title"
          >
            {product.title}
          </Heading>
        </FadeIn>

        <FadeIn delay={0.3}>
          <ProductDescription description={product.description} />
        </FadeIn>
      </div>
    </div>
  )
}

export default ProductInfo
