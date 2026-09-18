import { Heading } from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import { useParams } from "react-router-dom"

import { RouteDrawer } from "../../../components/modals"
import { Skeleton } from "../../../components/common/skeleton"
import { useOrder } from "../../../hooks/api"
import { DEFAULT_FIELDS } from "../order-detail/constants"
import { CreateOrderTransferForm } from "./components/create-order-transfer-form"

export const OrderRequestTransfer = () => {
  const { t } = useTranslation()
  const params = useParams()

  // Form is rendered bot on the order details page and customer page so we need to pick the correct param from URL
  const orderId = (params.order_id || params.id) as string

  const { order, isPending, isError } = useOrder(orderId, {
    fields: DEFAULT_FIELDS,
  })

  if (!isPending && isError) {
    throw new Error("Order not found")
  }

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <Heading>{t("orders.transfer.title")}</Heading>
      </RouteDrawer.Header>

      {isPending && !order && (
        <div className="p-6 space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-9 w-full rounded-md" />
            </div>
          ))}
        </div>
      )}

      {order && <CreateOrderTransferForm order={order} />}
    </RouteDrawer>
  )
}
