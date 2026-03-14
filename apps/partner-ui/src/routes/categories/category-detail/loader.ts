import { LoaderFunctionArgs } from "react-router-dom"

import { categoriesQueryKeys } from "../../../hooks/api/categories"
import { sdk } from "../../../lib/client"
import { queryClient } from "../../../lib/query-client"

const categoryDetailQuery = (id: string) => ({
  queryKey: categoriesQueryKeys.detail(id),
  queryFn: async () =>
    sdk.client.fetch<{ product_category: any }>(`/partners/product-categories/${id}`, {
      method: "GET",
    }),
})

export const categoryLoader = async ({ params }: LoaderFunctionArgs) => {
  const id = params.id
  const query = categoryDetailQuery(id!)

  return queryClient.ensureQueryData(query)
}
