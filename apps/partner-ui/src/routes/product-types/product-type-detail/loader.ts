import { LoaderFunctionArgs } from "react-router-dom"

import { productTypesQueryKeys } from "../../../hooks/api/product-types"
import { sdk } from "../../../lib/client"
import { queryClient } from "../../../lib/query-client"

const productTypeDetailQuery = (id: string) => ({
  queryKey: productTypesQueryKeys.detail(id),
  queryFn: async () =>
    sdk.client.fetch<any>(`/partners/product-types/${id}`, {
      method: "GET",
    }),
})

export const productTypeLoader = async ({ params }: LoaderFunctionArgs) => {
  const id = params.id
  const query = productTypeDetailQuery(id!)

  return queryClient.ensureQueryData(query)
}
