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

/**
 * Partner assistant conversation history (#338 item 2).
 *
 * Client for the partner-scoped conversation API
 * (`/partners/assistant/conversations`). The chat endpoint is stateless — these
 * hooks persist/restore the message array so a partner's chats survive reloads
 * and follow them across devices.
 */

export type StoredMessage = {
  id?: string
  role: "user" | "assistant" | "system"
  parts?: Array<{ type: string; [k: string]: unknown }>
  [k: string]: unknown
}

/** Light row for the history list (no message bodies). */
export type ConversationSummary = {
  id: string
  title: string
  created_at: string
  updated_at: string
}

/** Full conversation including the persisted message array. */
export type Conversation = ConversationSummary & {
  partner_id: string
  messages: StoredMessage[]
}

const CONVERSATIONS_QUERY_KEY = "partner-assistant-conversations" as const
export const conversationsQueryKeys = queryKeysFactory(CONVERSATIONS_QUERY_KEY)

export const usePartnerConversations = (
  options?: Omit<
    UseQueryOptions<
      { conversations: ConversationSummary[]; count: number },
      FetchError,
      { conversations: ConversationSummary[]; count: number },
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: conversationsQueryKeys.lists(),
    queryFn: () =>
      sdk.client.fetch<{ conversations: ConversationSummary[]; count: number }>(
        "/partners/assistant/conversations",
        { method: "GET" }
      ),
    ...options,
  })

  return { ...data, ...rest }
}

export const usePartnerConversation = (
  id: string | null,
  options?: Omit<
    UseQueryOptions<
      { conversation: Conversation },
      FetchError,
      { conversation: Conversation },
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: conversationsQueryKeys.detail(id ?? "none"),
    queryFn: () =>
      sdk.client.fetch<{ conversation: Conversation }>(
        `/partners/assistant/conversations/${id}`,
        { method: "GET" }
      ),
    enabled: !!id && options?.enabled !== false,
    ...options,
  })

  return { ...data, ...rest }
}

type CreateConversationBody = { title?: string; messages?: StoredMessage[] }

export const useCreateConversation = (
  options?: UseMutationOptions<
    { conversation: Conversation },
    FetchError,
    CreateConversationBody
  >
) => {
  return useMutation({
    ...options,
    mutationFn: (body: CreateConversationBody) =>
      sdk.client.fetch<{ conversation: Conversation }>(
        "/partners/assistant/conversations",
        { method: "POST", body }
      ),
    onSuccess: async (data, variables, context) => {
      await queryClient.invalidateQueries({
        queryKey: conversationsQueryKeys.lists(),
      })
      await options?.onSuccess?.(data, variables, context)
    },
  })
}

type UpdateConversationBody = { title?: string; messages?: StoredMessage[] }

export const useUpdateConversation = (
  id: string,
  options?: UseMutationOptions<
    { conversation: Conversation },
    FetchError,
    UpdateConversationBody
  >
) => {
  return useMutation({
    ...options,
    mutationFn: (body: UpdateConversationBody) =>
      sdk.client.fetch<{ conversation: Conversation }>(
        `/partners/assistant/conversations/${id}`,
        { method: "PATCH", body }
      ),
    onSuccess: async (data, variables, context) => {
      await queryClient.invalidateQueries({
        queryKey: conversationsQueryKeys.lists(),
      })
      await queryClient.invalidateQueries({
        queryKey: conversationsQueryKeys.detail(id),
      })
      await options?.onSuccess?.(data, variables, context)
    },
  })
}

export const useDeleteConversation = (
  options?: UseMutationOptions<{ deleted: boolean }, FetchError, string>
) => {
  return useMutation({
    ...options,
    mutationFn: (id: string) =>
      sdk.client.fetch<{ deleted: boolean }>(
        `/partners/assistant/conversations/${id}`,
        { method: "DELETE" }
      ),
    onSuccess: async (data, variables, context) => {
      await queryClient.invalidateQueries({
        queryKey: conversationsQueryKeys.lists(),
      })
      await options?.onSuccess?.(data, variables, context)
    },
  })
}
