import { LoaderFunctionArgs } from "react-router-dom"
import { productsQueryKeys } from "../../../hooks/api/products"
import { sdk } from "../../../lib/client"
import { queryClient } from "../../../lib/query-client"

const customerDetailQuery = (id: string) => ({
  queryKey: productsQueryKeys.detail(id),
  queryFn: async () =>
    sdk.client.fetch<any>(`/partners/customers/${id}`, {
      method: "GET",
    }),
})

export const customerLoader = async ({ params }: LoaderFunctionArgs) => {
  const id = params.id
  const query = customerDetailQuery(id!)

  return queryClient.ensureQueryData(query)
}
