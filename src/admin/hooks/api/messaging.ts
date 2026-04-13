import { FetchError } from "@medusajs/js-sdk"
import { useQuery, useMutation, useQueryClient, type UseQueryOptions, type QueryKey } from "@tanstack/react-query"
import { sdk } from "../../lib/config"
import { queryKeysFactory } from "../../lib/query-key-factory"

export interface ConversationPreview {
  id: string
  partner_id: string
  partner_name: string
  title: string | null
  phone_number: string
  status: "active" | "archived"
  unread_count: number
  last_message_at: string | null
  last_message: {
    content: string
    direction: "inbound" | "outbound"
    created_at: string
  } | null
  metadata: Record<string, any> | null
}

export interface Message {
  id: string
  conversation_id: string
  direction: "inbound" | "outbound"
  sender_name: string | null
  content: string
  message_type: string
  wa_message_id: string | null
  status: string
  context_type: string | null
  context_id: string | null
  context_snapshot: Record<string, any> | null
  media_url: string | null
  media_mime_type: string | null
  reply_to_id: string | null
  reply_to_snapshot: {
    content: string
    sender_name: string | null
    direction: "inbound" | "outbound"
    media_url?: string | null
    media_mime_type?: string | null
  } | null
  metadata: Record<string, any> | null
  created_at: string
}

export interface ConversationsResponse {
  conversations: ConversationPreview[]
  count: number
  offset: number
  limit: number
}

export interface ConversationDetailResponse {
  conversation: Omit<ConversationPreview, "last_message">
  messages: Message[]
  count: number
  offset: number
  limit: number
}

const MESSAGING_QUERY_KEY = "admin_messaging" as const
export const messagingQueryKeys = queryKeysFactory(MESSAGING_QUERY_KEY)

export const useConversations = (
  query?: { partner_id?: string; status?: string; limit?: number; offset?: number },
  options?: Omit<UseQueryOptions<ConversationsResponse, FetchError, ConversationsResponse, QueryKey>, "queryFn" | "queryKey">,
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch<ConversationsResponse>(`/admin/messaging`, {
        method: "GET",
        query,
      }) as Promise<ConversationsResponse>,
    queryKey: messagingQueryKeys.list(query),
    ...options,
  })
  return { ...data, ...rest }
}

export const useConversationMessages = (
  conversationId: string,
  query?: { limit?: number; offset?: number },
  options?: Omit<UseQueryOptions<ConversationDetailResponse, FetchError, ConversationDetailResponse, QueryKey>, "queryFn" | "queryKey">,
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch<ConversationDetailResponse>(`/admin/messaging/${conversationId}`, {
        method: "GET",
        query,
      }) as Promise<ConversationDetailResponse>,
    queryKey: messagingQueryKeys.detail(conversationId, query),
    enabled: !!conversationId,
    ...options,
  })
  return { ...data, ...rest }
}

export const useSendMessage = (conversationId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: {
      content: string
      context_type?: string
      context_id?: string
      media_url?: string
      media_mime_type?: string
      media_filename?: string
    }) =>
      sdk.client.fetch<{ message: Message }>(`/admin/messaging/${conversationId}`, {
        method: "POST",
        body,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: messagingQueryKeys.detail(conversationId) })
      queryClient.invalidateQueries({ queryKey: messagingQueryKeys.lists() })
    },
  })
}

export const useCreateConversation = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: {
      partner_id: string
      phone_number: string
      title?: string
    }) =>
      sdk.client.fetch<{ conversation: ConversationPreview }>(`/admin/messaging`, {
        method: "POST",
        body,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: messagingQueryKeys.lists() })
    },
  })
}

export const useArchiveConversation = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (conversationId: string) =>
      sdk.client.fetch(`/admin/messaging/${conversationId}/archive`, {
        method: "POST",
        body: {},
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: messagingQueryKeys.lists() })
    },
  })
}

export const useDeleteConversation = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (conversationId: string) =>
      sdk.client.fetch(`/admin/messaging/${conversationId}/delete`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: messagingQueryKeys.lists() })
    },
  })
}
