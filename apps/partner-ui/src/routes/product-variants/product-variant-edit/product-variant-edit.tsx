import { Heading } from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import { useLoaderData, useParams, useSearchParams } from "react-router-dom"
import { RouteDrawer } from "../../../components/modals"
import { useProduct, useProductVariant } from "../../../hooks/api/products"
import { ProductEditVariantForm } from "./components/product-edit-variant-form"
import { editProductVariantLoader } from "./loader"

export const ProductVariantEdit = () => {
  const initialData = useLoaderData() as Awaited<
    ReturnType<typeof editProductVariantLoader>
  > | undefined

  const { t } = useTranslation()
  const { id } = useParams()
  const [URLSearchParms] = useSearchParams()
  const searchVariantId = URLSearchParms.get("variant_id")

  const variantId = searchVariantId || ""

  const { variant, isPending, isError, error } = useProductVariant(
    id!,
    variantId,
    undefined,
    {
      initialData,
      enabled: !!variantId,
    }
  )

  const productId = variant?.product_id || id
  const {
    product,
    isPending: isProductPending,
    isError: isProductError,
    error: productError,
  } = useProduct(
    productId!,
    {
      fields: "-type,-collection,-tags,-images,-variants,-sales_channels",
    },
    {
      enabled: !!productId,
    }
  )

  const ready = !isPending && !!variant && !isProductPending && !!product

  if (isError) {
    throw error
  }

  if (isProductError) {
    throw productError
  }

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <Heading>{t("products.variant.edit.header")}</Heading>
      </RouteDrawer.Header>
      {ready && <ProductEditVariantForm variant={variant} product={product} />}
    </RouteDrawer>
  )
}
