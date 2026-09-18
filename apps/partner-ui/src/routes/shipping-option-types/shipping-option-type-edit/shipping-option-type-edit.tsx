import { Heading } from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import { useParams } from "react-router-dom"
import { RouteDrawer } from "../../../components/modals"
import { Skeleton } from "../../../components/common/skeleton"
import { useShippingOptionType } from "../../../hooks/api"
import { EditShippingOptionTypeForm } from "./components/edit-shipping-option-type-form"

export const ShippingOptionTypeEdit = () => {
  const { id } = useParams()
  const { t } = useTranslation()

  const { shipping_option_type, isPending, isError, error } =
    useShippingOptionType(id!)

  const ready = !isPending && !!shipping_option_type

  if (isError) {
    throw error
  }

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <Heading>{t("shippingOptionTypes.edit.header")}</Heading>
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
      {ready && (
        <EditShippingOptionTypeForm shippingOptionType={shipping_option_type} />
      )}
    </RouteDrawer>
  )
}
