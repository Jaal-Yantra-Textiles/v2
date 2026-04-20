import { LoaderFunctionArgs } from "react-router-dom"
import { sdk } from "../../../lib/config"
import { queryClient } from "../../../lib/query-client"
import type { StatsDashboard } from "../../../hooks/api/stats"

const dashboardQuery = (id: string) => ({
  queryKey: ["stats-dashboards", id],
  queryFn: async () =>
    sdk.client.fetch<{ dashboard: StatsDashboard }>(
      `/admin/stats/dashboards/${id}`,
      { method: "GET" }
    ),
})

export const statsDashboardLoader = async ({ params }: LoaderFunctionArgs) => {
  const id = params.id!
  return queryClient.ensureQueryData(dashboardQuery(id))
}
