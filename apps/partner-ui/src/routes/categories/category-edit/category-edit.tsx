import { Heading } from "@medusajs/ui"

import { useTranslation } from "react-i18next"
import { useParams } from "react-router-dom"
import { RouteDrawer } from "../../../components/modals"
import { Skeleton } from "../../../components/common/skeleton"
import { useProductCategory } from "../../../hooks/api/categories"
import { EditCategoryForm } from "./components/edit-category-form"

export const CategoryEdit = () => {
  const { id } = useParams()
  const { t } = useTranslation()

  const { product_category, isPending, isError, error } = useProductCategory(
    id!
  )

  const ready = !isPending && !!product_category

  if (isError) {
    throw error
  }

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <RouteDrawer.Title asChild>
          <Heading>{t("categories.edit.header")}</Heading>
        </RouteDrawer.Title>
        <RouteDrawer.Description className="sr-only">
          {t("categories.edit.description")}
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
      {ready && <EditCategoryForm category={product_category} />}
    </RouteDrawer>
  )
}
