import { paymentReportQueryKeys } from "../../../hooks/api/payment-reports"
import { sdk } from "../../../lib/config"
import { queryClient } from "../../../lib/query-client"

const paymentReportDetailQuery = (id: string) => ({
  queryKey: paymentReportQueryKeys.detail(id),
  queryFn: async () =>
    sdk.client.fetch<{ payment_report: any }>(`/admin/payment_reports/${id}`, {
      method: "GET",
    }),
})

export const paymentReportLoader = async ({ params }: any) => {
  const id = params.id as string
  const query = paymentReportDetailQuery(id)
  return queryClient.ensureQueryData(query)
}
