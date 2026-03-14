import { HttpTypes } from "@medusajs/types"
import { productsQueryKeys } from "../../../hooks/api/products"
import { sdk } from "../../../lib/client"
import { queryClient } from "../../../lib/query-client"
import { getPartnerStoreId } from "../../../lib/partner-store-id"

const productsListQuery = (storeId: string) => ({
  queryKey: productsQueryKeys.list({
    limit: 20,
    offset: 0,
  }),
  queryFn: async () =>
    sdk.client.fetch<{ products: any[]; count: number }>(
      `/partners/stores/${storeId}/products`,
      { method: "GET" }
    ),
})

export const productsLoader = async () => {
  const storeId = await getPartnerStoreId()
  if (!storeId) return null

  const query = productsListQuery(storeId)

  return (
    queryClient.getQueryData<HttpTypes.AdminProductListResponse>(
      query.queryKey
    ) ?? (await queryClient.fetchQuery(query))
  )
}
