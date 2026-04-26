import { failedNotificationsQueryKeys } from "../../../../hooks/api/notifications"
import { sdk } from "../../../../lib/config"
import { queryClient } from "../../../../lib/query-client"

const notificationDetailQuery = (id: string) => ({
  queryKey: failedNotificationsQueryKeys.detail(id),
  queryFn: async () =>
    sdk.client.fetch<{ notification: any }>(`/admin/notifications/${id}`, {
      method: "GET",
      query: {
        fields: 'id,to,channel,template,external_id,provider_id,created_at,status,data'
      }
    }),
})

export const notificationLoader = async ({ params }: any) => {
  const id = params.id
  const query = notificationDetailQuery(id!)

  return queryClient.ensureQueryData(query)
}
