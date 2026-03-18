import { LoaderFunctionArgs } from "react-router-dom"

import { variantsQueryKeys } from "../../../hooks/api/products"
import { sdk } from "../../../lib/client"
import { queryClient } from "../../../lib/query-client"
import { VARIANT_DETAIL_FIELDS } from "./constants"

const variantDetailQuery = (productId: string, variantId: string, storeId: string) => ({
  queryKey: variantsQueryKeys.detail(variantId, {
    fields: VARIANT_DETAIL_FIELDS,
  }),
  queryFn: async () =>
    sdk.client.fetch<{ variant: any }>(
      `/partners/stores/${storeId}/products/${productId}/variants/${variantId}`,
      { method: "GET" }
    ),
})

export const variantLoader = async ({ params }: LoaderFunctionArgs) => {
  const productId = params.id
  const variantId = params.variant_id

  // Get storeId from cached partner-stores query
  let storeId = ""
  try {
    const cached = queryClient.getQueriesData<any>({ queryKey: ["partner_stores"] })
    for (const [, data] of cached) {
      if (data?.stores?.[0]?.id) {
        storeId = data.stores[0].id
        break
      }
    }
  } catch {
    // Component hooks will handle it
  }

  if (!storeId || !productId || !variantId) {
    return undefined
  }

  const query = variantDetailQuery(productId, variantId, storeId)

  return queryClient.ensureQueryData(query)
}
