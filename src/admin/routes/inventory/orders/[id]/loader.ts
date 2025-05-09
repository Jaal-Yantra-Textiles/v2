import { LoaderFunctionArgs } from "react-router-dom"
import { AdminInventoryOrderResponse, inventoryOrderQueryKeys } from "../../../../hooks/api/inventory-orders"
import { sdk } from "../../../../lib/config"
import { queryClient } from "../../../../lib/query-client"



const inventoryOrderDetailQuery = (id: string) => ({
  queryKey: inventoryOrderQueryKeys.detail(id, { fields: ['orderlines.*', 'orderlines.inventory_items.*', 'stock_locations.*', 'stock_locations.address.*'] }),
  queryFn: async () =>
     sdk.client.fetch<AdminInventoryOrderResponse>(`/admin/inventory-orders/${id}`, {
            method: "GET",
            query: {
              fields: ['orderlines.*', 'orderlines.inventory_items.*', 'stock_locations.*', 'stock_locations.address.*']
            }
    }),
})

export const inventoryOrderLoader = async ({ params }: LoaderFunctionArgs) => {
  const id = params.id
  const query = inventoryOrderDetailQuery(id!)

  const response = await queryClient.ensureQueryData({
    ...query,
    staleTime: 90000,
  })

  return response
}