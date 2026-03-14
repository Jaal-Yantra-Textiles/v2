import { FetchError } from "@medusajs/js-sdk"
import { HttpTypes } from "@medusajs/types"
import {
  QueryKey,
  useMutation,
  UseMutationOptions,
  useQuery,
  UseQueryOptions,
} from "@tanstack/react-query"
import { sdk } from "../../lib/client"
import { queryClient } from "../../lib/query-client"
import { queryKeysFactory } from "../../lib/query-key-factory"
import { ordersQueryKeys } from "./orders"
import { returnsQueryKeys } from "./returns"

const EXCHANGES_QUERY_KEY = "exchanges" as const
export const exchangesQueryKeys = queryKeysFactory(EXCHANGES_QUERY_KEY)

export const useExchange = (
  id: string,
  query?: HttpTypes.AdminExchangeListParams,
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminExchangeResponse,
      FetchError,
      HttpTypes.AdminExchangeResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch(`/partners/exchanges/${id}`, { method: "GET", query }),
    queryKey: exchangesQueryKeys.detail(id, query),
    ...options,
  })

  return { ...data, ...rest }
}

export const useExchanges = (
  query?: HttpTypes.AdminExchangeListParams,
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminExchangeListParams,
      FetchError,
      HttpTypes.AdminExchangeListResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch(`/partners/exchanges`, { method: "GET", query }),
    queryKey: exchangesQueryKeys.list(query),
    ...options,
  })

  return { ...data, ...rest }
}

export const useCreateExchange = (
  orderId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminExchangeResponse,
    FetchError,
    HttpTypes.AdminCreateExchange
  >
) => {
  return useMutation({
    mutationFn: (payload: HttpTypes.AdminCreateExchange) =>
      sdk.client.fetch(`/partners/exchanges`, { method: "POST", body: payload }),
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.details(),
      })

      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.preview(orderId),
      })

      queryClient.invalidateQueries({
        queryKey: exchangesQueryKeys.lists(),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useCancelExchange = (
  id: string,
  orderId: string,
  options?: UseMutationOptions<HttpTypes.AdminExchangeResponse, FetchError>
) => {
  return useMutation({
    mutationFn: () =>
      sdk.client.fetch(`/partners/exchanges/${id}/cancel`, { method: "POST" }),
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.details(),
      })

      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.preview(orderId),
      })

      queryClient.invalidateQueries({
        queryKey: exchangesQueryKeys.details(),
      })

      queryClient.invalidateQueries({
        queryKey: exchangesQueryKeys.lists(),
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useAddExchangeInboundItems = (
  id: string,
  orderId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminExchangeResponse,
    FetchError,
    HttpTypes.AdminAddExchangeInboundItems
  >
) => {
  return useMutation({
    mutationFn: (payload: HttpTypes.AdminAddExchangeInboundItems) =>
      sdk.client.fetch(`/partners/exchanges/${id}/inbound-items`, { method: "POST", body: payload }),
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.preview(orderId),
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useUpdateExchangeInboundItem = (
  id: string,
  orderId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminExchangeResponse,
    FetchError,
    HttpTypes.AdminUpdateExchangeInboundItem & { actionId: string }
  >
) => {
  return useMutation({
    mutationFn: ({
      actionId,
      ...payload
    }: HttpTypes.AdminUpdateExchangeInboundItem & { actionId: string }) => {
      return sdk.client.fetch(`/partners/exchanges/${id}/inbound-items/${actionId}`, { method: "POST", body: payload })
    },
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.preview(orderId),
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useRemoveExchangeInboundItem = (
  id: string,
  orderId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminExchangeResponse,
    FetchError,
    string
  >
) => {
  return useMutation({
    mutationFn: (actionId: string) =>
      sdk.client.fetch(`/partners/exchanges/${id}/inbound-items/${actionId}`, { method: "DELETE" }),
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.details(),
      })

      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.preview(orderId),
      })

      queryClient.invalidateQueries({
        queryKey: returnsQueryKeys.details(),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useAddExchangeInboundShipping = (
  id: string,
  orderId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminExchangeResponse,
    FetchError,
    HttpTypes.AdminExchangeAddInboundShipping
  >
) => {
  return useMutation({
    mutationFn: (payload: HttpTypes.AdminExchangeAddInboundShipping) =>
      sdk.client.fetch(`/partners/exchanges/${id}/inbound-shipping`, { method: "POST", body: payload }),
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.preview(orderId),
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useUpdateExchangeInboundShipping = (
  id: string,
  orderId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminExchangeResponse,
    FetchError,
    HttpTypes.AdminExchangeUpdateInboundShipping
  >
) => {
  return useMutation({
    mutationFn: ({
      actionId,
      ...payload
    }: HttpTypes.AdminExchangeUpdateInboundShipping & { actionId: string }) =>
      sdk.client.fetch(`/partners/exchanges/${id}/inbound-shipping/${actionId}`, { method: "POST", body: payload }),
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.preview(orderId),
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useDeleteExchangeInboundShipping = (
  id: string,
  orderId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminExchangeResponse,
    FetchError,
    string
  >
) => {
  return useMutation({
    mutationFn: (actionId: string) =>
      sdk.client.fetch(`/partners/exchanges/${id}/inbound-shipping/${actionId}`, { method: "DELETE" }),
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.preview(orderId),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useAddExchangeOutboundItems = (
  id: string,
  orderId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminExchangeResponse,
    FetchError,
    HttpTypes.AdminAddExchangeOutboundItems
  >
) => {
  return useMutation({
    mutationFn: (payload: HttpTypes.AdminAddExchangeOutboundItems) =>
      sdk.client.fetch(`/partners/exchanges/${id}/outbound-items`, { method: "POST", body: payload }),
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.preview(orderId),
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useUpdateExchangeOutboundItems = (
  id: string,
  orderId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminExchangeResponse,
    FetchError,
    HttpTypes.AdminUpdateExchangeOutboundItem & { actionId: string }
  >
) => {
  return useMutation({
    mutationFn: ({
      actionId,
      ...payload
    }: HttpTypes.AdminUpdateExchangeOutboundItem & { actionId: string }) => {
      return sdk.client.fetch(`/partners/exchanges/${id}/outbound-items/${actionId}`, { method: "POST", body: payload })
    },
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.preview(orderId),
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useRemoveExchangeOutboundItem = (
  id: string,
  orderId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminExchangeResponse,
    FetchError,
    string
  >
) => {
  return useMutation({
    mutationFn: (actionId: string) =>
      sdk.client.fetch(`/partners/exchanges/${id}/outbound-items/${actionId}`, { method: "DELETE" }),
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.details(),
      })

      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.preview(orderId),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useAddExchangeOutboundShipping = (
  id: string,
  orderId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminExchangeResponse,
    FetchError,
    HttpTypes.AdminExchangeAddOutboundShipping
  >
) => {
  return useMutation({
    mutationFn: (payload: HttpTypes.AdminExchangeAddOutboundShipping) =>
      sdk.client.fetch(`/partners/exchanges/${id}/outbound-shipping`, { method: "POST", body: payload }),
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.preview(orderId),
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useUpdateExchangeOutboundShipping = (
  id: string,
  orderId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminExchangeResponse,
    FetchError,
    HttpTypes.AdminExchangeUpdateOutboundShipping
  >
) => {
  return useMutation({
    mutationFn: ({
      actionId,
      ...payload
    }: HttpTypes.AdminExchangeUpdateOutboundShipping & { actionId: string }) =>
      sdk.client.fetch(`/partners/exchanges/${id}/outbound-shipping/${actionId}`, { method: "POST", body: payload }),
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.preview(orderId),
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useDeleteExchangeOutboundShipping = (
  id: string,
  orderId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminExchangeResponse,
    FetchError,
    string
  >
) => {
  return useMutation({
    mutationFn: (actionId: string) =>
      sdk.client.fetch(`/partners/exchanges/${id}/outbound-shipping/${actionId}`, { method: "DELETE" }),
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.preview(orderId),
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useExchangeConfirmRequest = (
  id: string,
  orderId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminExchangeResponse,
    FetchError,
    HttpTypes.AdminRequestExchange
  >
) => {
  return useMutation({
    mutationFn: (payload: HttpTypes.AdminRequestExchange) =>
      sdk.client.fetch(`/partners/exchanges/${id}/request`, { method: "POST", body: payload }),
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({
        queryKey: returnsQueryKeys.all,
      })

      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.details(),
      })

      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.preview(orderId),
      })

      queryClient.invalidateQueries({
        queryKey: exchangesQueryKeys.lists(),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useCancelExchangeRequest = (
  id: string,
  orderId: string,
  options?: UseMutationOptions<HttpTypes.AdminExchangeResponse, FetchError>
) => {
  return useMutation({
    mutationFn: () =>
      sdk.client.fetch(`/partners/exchanges/${id}/request/cancel`, { method: "POST" }),
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.details(),
      })

      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.preview(orderId),
      })

      queryClient.invalidateQueries({
        queryKey: exchangesQueryKeys.details(),
      })
      queryClient.invalidateQueries({
        queryKey: exchangesQueryKeys.lists(),
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}
