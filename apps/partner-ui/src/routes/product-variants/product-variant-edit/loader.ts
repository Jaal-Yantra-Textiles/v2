import { LoaderFunctionArgs } from "react-router-dom"

import { productVariantQueryKeys } from "../../../hooks/api"
import { sdk } from "../../../lib/client"
import { queryClient } from "../../../lib/query-client"

const queryFn = async (productId: string, variantId: string, storeId: string) => {
  return await sdk.client.fetch<{ variant: any }>(
    `/partners/stores/${storeId}/products/${productId}/variants/${variantId}`,
    { method: "GET" }
  )
}

const editProductVariantQuery = (productId: string, variantId: string, storeId: string) => ({
  queryKey: productVariantQueryKeys.detail(variantId),
  queryFn: async () => queryFn(productId, variantId, storeId),
})

export const editProductVariantLoader = async ({
  params,
  request,
}: LoaderFunctionArgs) => {
  try {
    const id = params.id
    const searchParams = new URL(request.url).searchParams
    const searchVariantId = searchParams.get("variant_id")
    const variantId = params.variant_id || searchVariantId

    if (!variantId || !id) {
      return undefined
    }

    // Get storeId from cached partner-stores query
    let storeId = ""
    const cached = queryClient.getQueriesData<any>({ queryKey: ["partner_stores"] })
    for (const [, data] of cached) {
      if (data?.stores?.[0]?.id) {
        storeId = data.stores[0].id
        break
      }
    }

    if (!storeId) {
      return undefined
    }

    const query = editProductVariantQuery(id, variantId, storeId)
    return (
      queryClient.getQueryData<ReturnType<typeof queryFn>>(query.queryKey) ??
      (await queryClient.fetchQuery(query))
    )
  } catch {
    // Loader errors should not crash the page — the component's hooks will handle data fetching
    return undefined
  }
}
