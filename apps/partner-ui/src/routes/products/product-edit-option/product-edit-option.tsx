import { Heading } from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import { json, useParams } from "react-router-dom"
import { RouteDrawer } from "../../../components/modals"
import { useProduct } from "../../../hooks/api/products"
import { CreateProductOptionForm } from "./components/edit-product-option-form"

export const ProductEditOption = () => {
  const { id, optionId } = useParams()
  const { t } = useTranslation()

  const { product, isPending, isFetching, isError, error } = useProduct(id!, {
    // TODO: Remove exclusion once we avoid including unnecessary relations by default in the query config
    fields: "-type,-collection,-tags,-images,-variants,-sales_channels",
  })

  const option = product?.options.find((o) => o.id === optionId)

  if (!isPending && !isFetching && !option) {
    throw json({ message: `An option with ID ${optionId} was not found` }, 404)
  }

  if (isError) {
    throw error
  }

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <Heading>{t("products.options.edit.header")}</Heading>
      </RouteDrawer.Header>
      {option && (
        // Pass the product id from the route: `option.product_id` is null on
        // every option since 2.16 made options global, so the form cannot get
        // it from the option itself.
        <CreateProductOptionForm option={option} productId={id!} />
      )}
    </RouteDrawer>
  )
}
