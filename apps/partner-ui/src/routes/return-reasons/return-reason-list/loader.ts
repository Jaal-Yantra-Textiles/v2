import { returnReasonsQueryKeys } from "../../../hooks/api/return-reasons"
import { sdk } from "../../../lib/client"
import { queryClient } from "../../../lib/query-client"

const returnReasonListQuery = (query?: Record<string, any>) => ({
  queryKey: returnReasonsQueryKeys.list(query),
  queryFn: async () =>
    sdk.client.fetch<{ return_reasons: any[]; count: number }>(
      "/partners/return-reasons",
      { method: "GET", query }
    ),
})

export const returnReasonListLoader = async () => {
  const query = returnReasonListQuery()
  return (
    queryClient.getQueryData(query.queryKey) ??
    (await queryClient.fetchQuery(query))
  )
}
