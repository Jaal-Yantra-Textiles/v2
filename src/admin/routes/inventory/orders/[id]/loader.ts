import { AdminInventoryOrderResponse, inventoryOrderQueryKeys } from "../../../../hooks/api/inventory-orders"
import { sdk } from "../../../../lib/config"
import { queryClient } from "../../../../lib/query-client"
import { INVENTORY_ORDER_DETAIL_FIELDS } from "./constants"



const inventoryOrderDetailQuery = (id: string) => ({
  queryKey: inventoryOrderQueryKeys.detail(id),
  queryFn: async () =>
     sdk.client.fetch<AdminInventoryOrderResponse>(`/admin/inventory-orders/${id}`, {
            method: "GET",
            query: {
              fields: INVENTORY_ORDER_DETAIL_FIELDS
            }
    }),
})

export const inventoryOrderLoader = async ({ params }: any) => {
  const id = params.id
  const query = inventoryOrderDetailQuery(id!)

  const response = await queryClient.ensureQueryData({
    ...query,
  })

  return response
}