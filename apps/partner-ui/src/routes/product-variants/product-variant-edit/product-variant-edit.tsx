import { Heading, Text } from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import { useParams, useSearchParams } from "react-router-dom"
import { RouteDrawer } from "../../../components/modals"
import { Skeleton } from "../../../components/common/skeleton"
import { useProduct, useProductVariant } from "../../../hooks/api/products"
import { ProductEditVariantForm } from "./components/product-edit-variant-form"

export const ProductVariantEdit = () => {
  const { t } = useTranslation()
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const variantId = searchParams.get("variant_id") || ""

  const { variant, isPending, isError, error } = useProductVariant(
    id!,
    variantId,
    undefined,
    { enabled: !!id && !!variantId }
  )

  const productId = variant?.product_id || id
  const {
    product,
    isPending: isProductPending,
    isError: isProductError,
    error: productError,
  } = useProduct(
    productId!,
    undefined,
    { enabled: !!productId }
  )

  const ready = !isPending && !!variant && !isProductPending && !!product

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <Heading>{t("products.variant.edit.header")}</Heading>
      </RouteDrawer.Header>
      {isError && (
        <div className="p-6">
          <Text className="text-ui-fg-error">
            {(error as any)?.message || "Failed to load variant"}
          </Text>
        </div>
      )}
      {isProductError && (
        <div className="p-6">
          <Text className="text-ui-fg-error">
            {(productError as any)?.message || "Failed to load product"}
          </Text>
        </div>
      )}
      {!ready && !isError && !isProductError && (
        <div className="p-6 space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-9 w-full rounded-md" />
            </div>
          ))}
        </div>
      )}
      {ready && <ProductEditVariantForm variant={variant} product={product} />}
    </RouteDrawer>
  )
}
