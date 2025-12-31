import { FetchError } from "@medusajs/js-sdk";
import {
  QueryKey,
  UseMutationOptions,
  UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { sdk } from "../../lib/config";
import { queryKeysFactory } from "../../lib/query-key-factory";

export type Notification = {
  id: string;
  to: string;
  channel: string;
  template: string;
  status?: "pending" | "success" | "failure";
  external_id?: string | null;
  created_at: string;
  updated_at?: string;
  data?: Record<string, any> | null;
  provider_id: string;
  from?: string | null;
  provider_data?: Record<string, any> | null;
  trigger_type?: string | null;
  resource_id?: string | null;
  resource_type?: string | null;
  receiver_id?: string | null;
  original_notification_id?: string | null;
  idempotency_key?: string | null;
};

export const useNotification = (
  id: string,
  options?: Omit<
    UseQueryOptions<AdminNotificationResponse, FetchError, AdminNotificationResponse, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: failedNotificationsQueryKeys.detail(id),
    queryFn: async () => {
      return sdk.client.fetch<AdminNotificationResponse>(`/admin/notifications/${id}`, {
        method: "GET",
      })
    },
    ...options,
    enabled: Boolean(id) && (options as any)?.enabled !== false,
  })

  return {
    notification: data?.notification,
    ...rest,
  }
}

// Backward compatible alias (older UI referred to all items as "failed notifications")
export type FailedNotification = Notification;

export interface FailedNotificationsQuery {
  channel?: string;
  status?: string;
  limit?: number;
  offset?: number;
  q?: string;
  fields?: string;
  [key: string]: any;
}

export type AdminNotificationListItem = Notification & {
  status?: "pending" | "success" | "failure";
 }

 export interface AdminNotificationsListResponse {
  notifications: AdminNotificationListItem[];
  count: number;
  offset: number;
  limit: number;
 }

export interface FailedNotificationsResponse {
  notifications: Notification[];
  failed_emails: Notification[];
  total: number;
  failed_count: number;
}

export interface AdminNotificationResponse {
  notification: Notification;
}

export interface RetryEmailData {
  notificationId: string;
  to: string;
  template: string;
  data?: Record<string, any> | null;
}

const FAILED_NOTIFICATIONS_QUERY_KEY = "failed-notifications" as const;
export const failedNotificationsQueryKeys = queryKeysFactory(FAILED_NOTIFICATIONS_QUERY_KEY);

export const useNotifications = (
  query?: FailedNotificationsQuery,
  options?: Omit<
    UseQueryOptions<FailedNotificationsResponse, FetchError, FailedNotificationsResponse, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: failedNotificationsQueryKeys.list(query),
    queryFn: async () => {
      const res = await sdk.client.fetch<AdminNotificationsListResponse>("/admin/notifications/custom", {
        method: "GET",
        query: {
          limit: query?.limit ?? 20,
          offset: query?.offset ?? 0,
          q: query?.q,
          channel: query?.channel,
          status: query?.status,
          fields:
            query?.fields ??
            "id,to,channel,template,external_id,provider_id,created_at,status,data",
        },
      })

      const notifications = res.notifications || []
      const count = res.count ?? notifications.length

      return {
        notifications,
        failed_emails: notifications,
        total: count,
        failed_count: count,
      }
    },
    ...options,
  });
  
  return {
    notifications: data?.notifications ?? [],
    failed_emails: data?.failed_emails ?? [],
    total: data?.total ?? 0,
    failed_count: data?.failed_count ?? 0,
    ...rest,
  };
};

// Backward compatible export
export const useFailedNotifications = useNotifications;

export const useRetryFailedEmail = (
  options?: UseMutationOptions<any, Error, RetryEmailData>
) => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (data: RetryEmailData) => {
      return sdk.client.fetch<any>(
        `/admin/notifications/${data.notificationId}/retry`,
        {
          method: "POST",
          body: data,
        }
      )
    },
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: failedNotificationsQueryKeys.lists() });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
};
