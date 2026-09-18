import { Heading } from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import { useParams } from "react-router-dom"
import { RouteDrawer } from "../../../components/modals"
import { Skeleton } from "../../../components/common/skeleton"
import { useCustomerGroup } from "../../../hooks/api/customer-groups"
import { EditCustomerGroupForm } from "./components/edit-customer-group-form"

export const CustomerGroupEdit = () => {
  const { id } = useParams()
  const { customer_group, isLoading, isError, error } = useCustomerGroup(id!)

  const { t } = useTranslation()

  if (isError) {
    throw error
  }

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <Heading>{t("customerGroups.edit.header")}</Heading>
      </RouteDrawer.Header>
      {isLoading && (
        <div className="p-6 space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-9 w-full rounded-md" />
            </div>
          ))}
        </div>
      )}
      {!isLoading && customer_group && (
        <EditCustomerGroupForm group={customer_group} />
      )}
    </RouteDrawer>
  )
}
