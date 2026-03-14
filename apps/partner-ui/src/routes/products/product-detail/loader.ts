import { LoaderFunctionArgs } from "react-router-dom"

import { productsQueryKeys } from "../../../hooks/api/products"
import { sdk } from "../../../lib/client"
import { queryClient } from "../../../lib/query-client"
import { getPartnerStoreId } from "../../../lib/partner-store-id"

const productDetailQuery = (storeId: string, id: string) => ({
  queryKey: productsQueryKeys.detail(id),
  queryFn: async () =>
    sdk.client.fetch<{ product: any }>(
      `/partners/stores/${storeId}/products/${id}`,
      { method: "GET" }
    ),
})

export const productLoader = async ({ params }: LoaderFunctionArgs) => {
  const id = params.id
  const storeId = await getPartnerStoreId()
  if (!storeId) return null

  const query = productDetailQuery(storeId, id!)

  const response = await queryClient.ensureQueryData({
    ...query,
    staleTime: 90000,
  })

  return response
}
