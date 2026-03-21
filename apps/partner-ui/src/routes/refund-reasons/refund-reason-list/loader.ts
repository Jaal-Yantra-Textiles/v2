import { refundReasonsQueryKeys } from "../../../hooks/api"
import { sdk } from "../../../lib/client"
import { queryClient } from "../../../lib/query-client"

const refundReasonListQuery = () => ({
  queryKey: refundReasonsQueryKeys.list(),
  queryFn: async () =>
    sdk.client.fetch<{ refund_reasons: any[]; count: number }>(
      "/partners/refund-reasons",
      { method: "GET" }
    ),
})

export const refundReasonListLoader = async () => {
  const query = refundReasonListQuery()
  return (
    queryClient.getQueryData(query.queryKey) ??
    (await queryClient.fetchQuery(query))
  )
}
