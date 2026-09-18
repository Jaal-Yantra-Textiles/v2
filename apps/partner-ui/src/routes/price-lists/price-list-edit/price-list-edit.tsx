import { Heading } from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import { useParams } from "react-router-dom"
import { RouteDrawer } from "../../../components/modals"
import { Skeleton } from "../../../components/common/skeleton"
import { usePriceList } from "../../../hooks/api/price-lists"
import { PriceListEditForm } from "./components/price-list-edit-form"

export const PriceListEdit = () => {
  const { t } = useTranslation()
  const { id } = useParams()

  const { price_list, isLoading, isError, error } = usePriceList(id!)

  const ready = !isLoading && price_list

  if (isError) {
    throw error
  }

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <Heading>{t("priceLists.edit.header")}</Heading>
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
      {ready && <PriceListEditForm priceList={price_list} />}
    </RouteDrawer>
  )
}
