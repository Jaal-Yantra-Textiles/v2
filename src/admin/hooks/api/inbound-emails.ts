import { FetchError } from "@medusajs/js-sdk"
import {
  QueryKey,
  UseMutationOptions,
  UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"

import { sdk } from "../../lib/config"
import { queryKeysFactory } from "../../lib/query-key-factory"

export interface AdminInboundEmail {
  id: string
  imap_uid: string
  message_id: string | null
  from_address: string
  to_addresses: string[]
  subject: string
  html_body: string
  text_body: string | null
  folder: string
  received_at: string
  status: "received" | "action_pending" | "processed" | "ignored"
  action_type: string | null
  action_result: Record<string, any> | null
  extracted_data: Record<string, any> | null
  error_message: string | null
  metadata: Record<string, any> | null
  created_at: string
  updated_at: string
}

export interface AdminInboundEmailsResponse {
  inbound_emails: AdminInboundEmail[]
  count: number
  offset: number
  limit: number
}

export interface AdminInboundEmailResponse {
  inbound_email: AdminInboundEmail
}

export interface AdminInboundEmailsQuery {
  offset?: number
  limit?: number
  status?: string
  from_address?: string
  folder?: string
  q?: string
}

export interface InboundEmailAction {
  type: string
  label: string
  description: string
}

export interface AdminInboundEmailActionsResponse {
  actions: InboundEmailAction[]
}

export interface SyncResponse {
  synced: number
  skipped: number
  total_fetched: number
  providers_synced: number
  errors?: string[]
}

export interface ExtractResponse {
  inbound_email_id: string
  action_type: string
  extracted_data: Record<string, any>
}

export interface ExecuteResponse {
  inbound_email_id: string
  action_type: string
  action_result: Record<string, any>
}

const INBOUND_EMAILS_QUERY_KEY = "inbound-emails" as const
export const inboundEmailQueryKeys = queryKeysFactory(INBOUND_EMAILS_QUERY_KEY)

export const useInboundEmails = (
  query?: AdminInboundEmailsQuery,
  options?: Omit<
    UseQueryOptions<AdminInboundEmailsResponse, FetchError, AdminInboundEmailsResponse, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch<AdminInboundEmailsResponse>(`/admin/inbound-emails`, {
        method: "GET",
        query,
      }),
    queryKey: inboundEmailQueryKeys.list(query),
    ...options,
  })
  return { ...data, ...rest }
}

export const useInboundEmail = (
  id: string,
  options?: Omit<
    UseQueryOptions<AdminInboundEmailResponse, FetchError, AdminInboundEmailResponse, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: inboundEmailQueryKeys.detail(id),
    queryFn: async () =>
      sdk.client.fetch<AdminInboundEmailResponse>(`/admin/inbound-emails/${id}`, {
        method: "GET",
      }),
    ...options,
  })
  return { ...data, ...rest }
}

export const useInboundEmailActions = (
  options?: Omit<
    UseQueryOptions<AdminInboundEmailActionsResponse, FetchError, AdminInboundEmailActionsResponse, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: ["inbound-email-actions"],
    queryFn: async () =>
      sdk.client.fetch<AdminInboundEmailActionsResponse>(`/admin/inbound-emails/actions`, {
        method: "GET",
      }),
    ...options,
  })
  return { ...data, ...rest }
}

export const useSyncInboundEmails = (
  options?: UseMutationOptions<SyncResponse, FetchError, { count?: number }>
) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: { count?: number }) =>
      sdk.client.fetch<SyncResponse>(`/admin/inbound-emails/sync`, {
        method: "POST",
        body: payload,
      }),
    onSuccess: (...args) => {
      queryClient.invalidateQueries({ queryKey: inboundEmailQueryKeys.lists() })
      options?.onSuccess?.(...args)
    },
    ...options,
  })
}

export const useExtractInboundEmail = (
  id: string,
  options?: UseMutationOptions<ExtractResponse, FetchError, { action_type: string }>
) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: { action_type: string }) =>
      sdk.client.fetch<ExtractResponse>(`/admin/inbound-emails/${id}/extract`, {
        method: "POST",
        body: payload,
      }),
    onSuccess: (...args) => {
      queryClient.invalidateQueries({ queryKey: inboundEmailQueryKeys.details() })
      options?.onSuccess?.(...args)
    },
    ...options,
  })
}

export const useExecuteInboundEmailAction = (
  id: string,
  options?: UseMutationOptions<
    ExecuteResponse,
    FetchError,
    { action_type: string; params: Record<string, any> }
  >
) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: { action_type: string; params: Record<string, any> }) =>
      sdk.client.fetch<ExecuteResponse>(`/admin/inbound-emails/${id}/execute`, {
        method: "POST",
        body: payload,
      }),
    onSuccess: (...args) => {
      queryClient.invalidateQueries({ queryKey: inboundEmailQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: inboundEmailQueryKeys.details() })
      options?.onSuccess?.(...args)
    },
    ...options,
  })
}

export const useIgnoreInboundEmail = (
  id: string,
  options?: UseMutationOptions<{ inbound_email_id: string; status: string }, FetchError, void>
) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () =>
      sdk.client.fetch<{ inbound_email_id: string; status: string }>(
        `/admin/inbound-emails/${id}/ignore`,
        { method: "POST" }
      ),
    onSuccess: (...args) => {
      queryClient.invalidateQueries({ queryKey: inboundEmailQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: inboundEmailQueryKeys.details() })
      options?.onSuccess?.(...args)
    },
    ...options,
  })
}
