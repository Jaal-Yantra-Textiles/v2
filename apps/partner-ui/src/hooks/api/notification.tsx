import { FetchError } from "@medusajs/js-sdk"
import {
  QueryKey,
  UseMutationOptions,
  UseQueryOptions,
  useMutation,
  useQuery,
} from "@tanstack/react-query"

import { sdk } from "../../lib/client"
import { queryClient } from "../../lib/query-client"
import { queryKeysFactory } from "../../lib/query-key-factory"

const NOTIFICATION_QUERY_KEY = "notification" as const
export const notificationQueryKeys = queryKeysFactory(NOTIFICATION_QUERY_KEY)

// Backend route shape mirrors GET /partners/notifications
export type PartnerNotification = {
  id: string
  to?: string | null
  channel: string
  template?: string | null
  external_id?: string | null
  provider_id?: string | null
  trigger_type?: string | null
  resource_type?: string | null
  resource_id?: string | null
  receiver_id?: string | null
  data?: Record<string, any> | null
  created_at: string
  is_unread: boolean
}

export type PartnerNotificationListParams = {
  limit?: number
  offset?: number
  q?: string
  channel?: string
  trigger_type?: string
  resource_type?: string
  only_unread?: boolean
  fields?: string
}

export type PartnerNotificationListResponse = {
  notifications: PartnerNotification[]
  count: number
  offset: number
  limit: number
  last_seen_at: string
}

export type PartnerNotificationsUnreadCountResponse = {
  unread_count: number
  last_seen_at: string
}

const buildListPath = (query?: PartnerNotificationListParams): string => {
  if (!query) return "/partners/notifications"
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue
    qs.set(k, String(v))
  }
  const s = qs.toString()
  return s ? `/partners/notifications?${s}` : "/partners/notifications"
}

export const useNotifications = (
  query?: PartnerNotificationListParams,
  options?: Omit<
    UseQueryOptions<
      PartnerNotificationListResponse,
      FetchError,
      PartnerNotificationListResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >,
) => {
  const { data, ...rest } = useQuery({
    queryKey: notificationQueryKeys.list(query),
    queryFn: () =>
      sdk.client.fetch<PartnerNotificationListResponse>(buildListPath(query), {
        method: "GET",
      }),
    ...options,
  })
  return { ...data, ...rest }
}

export const usePartnerNotificationsUnreadCount = (
  options?: Omit<
    UseQueryOptions<
      PartnerNotificationsUnreadCountResponse,
      FetchError,
      PartnerNotificationsUnreadCountResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >,
) => {
  return useQuery({
    queryKey: notificationQueryKeys.list({ unread: true }),
    queryFn: () =>
      sdk.client.fetch<PartnerNotificationsUnreadCountResponse>(
        "/partners/notifications/unread-count",
        { method: "GET" },
      ),
    ...options,
  })
}

export const useMarkAllPartnerNotificationsRead = (
  options?: UseMutationOptions<
    PartnerNotificationsUnreadCountResponse,
    FetchError,
    void
  >,
) => {
  return useMutation({
    mutationFn: () =>
      sdk.client.fetch<PartnerNotificationsUnreadCountResponse>(
        "/partners/notifications/mark-all-read",
        { method: "POST" },
      ),
    onSuccess: async (data, variables, context) => {
      // Refresh both the bell list and the badge count after marking read
      await queryClient.invalidateQueries({
        queryKey: notificationQueryKeys.lists(),
      })
      await queryClient.invalidateQueries({
        queryKey: notificationQueryKeys.all,
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}
