import { Heading } from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import { useParams } from "react-router-dom"
import { RouteDrawer } from "../../../components/modals"
import { Skeleton } from "../../../components/common/skeleton"
import { useProductType } from "../../../hooks/api/product-types"
import { EditProductTypeForm } from "./components/edit-product-type-form"

export const ProductTypeEdit = () => {
  const { id } = useParams()
  const { t } = useTranslation()

  const { product_type, isPending, isError, error } = useProductType(id!)

  const ready = !isPending && !!product_type

  if (isError) {
    throw error
  }

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <Heading>{t("productTypes.edit.header")}</Heading>
      </RouteDrawer.Header>
      {!ready && (
        <div className="p-6 space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-9 w-full rounded-md" />
            </div>
          ))}
        </div>
      )}
      {ready && <EditProductTypeForm productType={product_type} />}
    </RouteDrawer>
  )
}
