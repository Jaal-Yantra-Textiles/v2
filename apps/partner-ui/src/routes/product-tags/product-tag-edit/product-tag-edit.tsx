import { Heading } from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import { useParams } from "react-router-dom"
import { RouteDrawer } from "../../../components/modals"
import { Skeleton } from "../../../components/common/skeleton"
import { useProductTag } from "../../../hooks/api"
import { ProductTagEditForm } from "./components/product-tag-edit-form"

export const ProductTagEdit = () => {
  const { id } = useParams()
  const { t } = useTranslation()

  const { product_tag, isPending, isError, error } = useProductTag(id!)

  const ready = !isPending && !!product_tag

  if (isError) {
    throw error
  }

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <RouteDrawer.Title asChild>
          <Heading>{t("productTags.edit.header")}</Heading>
        </RouteDrawer.Title>
        <RouteDrawer.Description className="sr-only">
          {t("productTags.edit.subtitle")}
        </RouteDrawer.Description>
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
      {ready && <ProductTagEditForm productTag={product_tag} />}
    </RouteDrawer>
  )
}
