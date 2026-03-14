import { HttpTypes } from "@medusajs/types"
import {
  QueryKey,
  useMutation,
  UseMutationOptions,
  useQuery,
  UseQueryOptions,
} from "@tanstack/react-query"

import { FetchError } from "@medusajs/js-sdk"
import { sdk } from "../../lib/client"
import { queryClient } from "../../lib/query-client"
import { queryKeysFactory } from "../../lib/query-key-factory"
import { ordersQueryKeys } from "./orders"

const RETURNS_QUERY_KEY = "returns" as const
export const returnsQueryKeys = queryKeysFactory(RETURNS_QUERY_KEY)

export const useReturn = (
  id: string,
  query?: Record<string, any>,
  options?: Omit<
    UseQueryOptions<any, FetchError, any, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch(`/partners/returns/${id}`, { method: "GET", query }),
    queryKey: returnsQueryKeys.detail(id, query),
    ...options,
  })

  return { ...data, ...rest }
}

export const useReturns = (
  query?: HttpTypes.AdminReturnFilters,
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminReturnFilters,
      FetchError,
      HttpTypes.AdminReturnsResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch(`/partners/returns`, { method: "GET", query }),
    queryKey: returnsQueryKeys.list(query),
    ...options,
  })

  return { ...data, ...rest }
}

export const useInitiateReturn = (
  orderId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminReturnResponse,
    FetchError,
    HttpTypes.AdminInitiateReturnRequest
  >
) => {
  return useMutation({
    mutationFn: (payload: HttpTypes.AdminInitiateReturnRequest) =>
      sdk.client.fetch(`/partners/returns`, { method: "POST", body: payload }),
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.details(),
      })

      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.preview(orderId),
      })

      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.preview(orderId),
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useCancelReturn = (
  id: string,
  orderId: string,
  options?: UseMutationOptions<HttpTypes.AdminReturnResponse, FetchError>
) => {
  return useMutation({
    mutationFn: () =>
      sdk.client.fetch(`/partners/returns/${id}/cancel`, { method: "POST" }),
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.details(),
      })

      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.preview(orderId),
        refetchType: "all", // We want preview to be updated in the cache immediately
      })

      queryClient.invalidateQueries({
        queryKey: returnsQueryKeys.details(),
      })
      queryClient.invalidateQueries({
        queryKey: returnsQueryKeys.lists(),
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

/**
 * REQUEST RETURN
 */

export const useConfirmReturnRequest = (
  id: string,
  orderId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminReturnResponse,
    FetchError,
    HttpTypes.AdminConfirmReturnRequest
  >
) => {
  return useMutation({
    mutationFn: (payload: HttpTypes.AdminConfirmReturnRequest) =>
      sdk.client.fetch(`/partners/returns/${id}/confirm`, { method: "POST", body: payload }),
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
      queryClient.invalidateQueries({
        queryKey: returnsQueryKeys.lists(),
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useCancelReturnRequest = (
  id: string,
  orderId: string,
  options?: UseMutationOptions<HttpTypes.AdminReturnResponse, FetchError>
) => {
  return useMutation({
    mutationFn: () =>
      sdk.client.fetch(`/partners/returns/${id}/request/cancel`, { method: "POST" }),
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.details(),
      })

      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.preview(orderId),
        refetchType: "all", // We want preview to be updated in the cache immediately
      })

      queryClient.invalidateQueries({
        queryKey: returnsQueryKeys.details(),
      })

      queryClient.invalidateQueries({
        queryKey: returnsQueryKeys.lists(),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useAddReturnItem = (
  id: string,
  orderId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminReturnResponse,
    FetchError,
    HttpTypes.AdminAddReturnItems
  >
) => {
  return useMutation({
    mutationFn: (payload: HttpTypes.AdminAddReturnItems) =>
      sdk.client.fetch(`/partners/returns/${id}/items`, { method: "POST", body: payload }),
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

export const useUpdateReturnItem = (
  id: string,
  orderId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminReturnResponse,
    FetchError,
    HttpTypes.AdminUpdateReturnItems & { actionId: string }
  >
) => {
  return useMutation({
    mutationFn: ({
      actionId,
      ...payload
    }: HttpTypes.AdminUpdateReturnItems & { actionId: string }) => {
      return sdk.client.fetch(`/partners/returns/${id}/items/${actionId}`, { method: "POST", body: payload })
    },
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

export const useRemoveReturnItem = (
  id: string,
  orderId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminReturnResponse,
    FetchError,
    string
  >
) => {
  return useMutation({
    mutationFn: (actionId: string) =>
      sdk.client.fetch(`/partners/returns/${id}/items/${actionId}`, { method: "DELETE" }),
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

export const useUpdateReturn = (
  id: string,
  orderId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminReturnResponse,
    FetchError,
    HttpTypes.AdminUpdateReturnRequest
  >
) => {
  return useMutation({
    mutationFn: (payload: HttpTypes.AdminUpdateReturnRequest) => {
      return sdk.client.fetch(`/partners/returns/${id}/request`, { method: "POST", body: payload })
    },
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

export const useAddReturnShipping = (
  id: string,
  orderId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminReturnResponse,
    FetchError,
    HttpTypes.AdminAddReturnShipping
  >
) => {
  return useMutation({
    mutationFn: (payload: HttpTypes.AdminAddReturnShipping) =>
      sdk.client.fetch(`/partners/returns/${id}/shipping`, { method: "POST", body: payload }),
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

export const useUpdateReturnShipping = (
  id: string,
  orderId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminReturnResponse,
    FetchError,
    HttpTypes.AdminAddReturnShipping
  >
) => {
  return useMutation({
    mutationFn: ({
      actionId,
      ...payload
    }: HttpTypes.AdminAddReturnShipping & { actionId: string }) =>
      sdk.client.fetch(`/partners/returns/${id}/shipping/${actionId}`, { method: "POST", body: payload }),
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

export const useDeleteReturnShipping = (
  id: string,
  orderId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminReturnResponse,
    FetchError,
    string
  >
) => {
  return useMutation({
    mutationFn: (actionId: string) =>
      sdk.client.fetch(`/partners/returns/${id}/shipping/${actionId}`, { method: "DELETE" }),
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

/**
 * RECEIVE RETURN
 */

export const useInitiateReceiveReturn = (
  id: string,
  orderId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminReturnResponse,
    FetchError,
    HttpTypes.AdminInitiateReceiveReturn
  >
) => {
  return useMutation({
    mutationFn: (payload: HttpTypes.AdminInitiateReceiveReturn) =>
      sdk.client.fetch(`/partners/returns/${id}/receive`, { method: "POST", body: payload }),
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

export const useAddReceiveItems = (
  id: string,
  orderId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminReturnResponse,
    FetchError,
    HttpTypes.AdminReceiveItems
  >
) => {
  return useMutation({
    mutationFn: (payload: HttpTypes.AdminReceiveItems) =>
      sdk.client.fetch(`/partners/returns/${id}/receive-items`, { method: "POST", body: payload }),
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

export const useUpdateReceiveItem = (
  id: string,
  orderId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminReturnResponse,
    FetchError,
    HttpTypes.AdminUpdateReceiveItems & { actionId: string }
  >
) => {
  return useMutation({
    mutationFn: ({
      actionId,
      ...payload
    }: HttpTypes.AdminUpdateReceiveItems & { actionId: string }) => {
      return sdk.client.fetch(`/partners/returns/${id}/receive-items/${actionId}`, { method: "POST", body: payload })
    },
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

export const useRemoveReceiveItems = (
  id: string,
  orderId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminReturnResponse,
    FetchError,
    string
  >
) => {
  return useMutation({
    mutationFn: (actionId: string) => {
      return sdk.client.fetch(`/partners/returns/${id}/receive-items/${actionId}`, { method: "DELETE" })
    },
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

export const useAddDismissItems = (
  id: string,
  orderId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminReturnResponse,
    FetchError,
    HttpTypes.AdminDismissItems
  >
) => {
  return useMutation({
    mutationFn: (payload: HttpTypes.AdminDismissItems) =>
      sdk.client.fetch(`/partners/returns/${id}/dismiss-items`, { method: "POST", body: payload }),
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

export const useUpdateDismissItem = (
  id: string,
  orderId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminReturnResponse,
    FetchError,
    HttpTypes.AdminUpdateDismissItems & { actionId: string }
  >
) => {
  return useMutation({
    mutationFn: ({
      actionId,
      ...payload
    }: HttpTypes.AdminUpdateReceiveItems & { actionId: string }) => {
      return sdk.client.fetch(`/partners/returns/${id}/dismiss-items/${actionId}`, { method: "POST", body: payload })
    },
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

export const useRemoveDismissItem = (
  id: string,
  orderId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminReturnResponse,
    FetchError,
    string
  >
) => {
  return useMutation({
    mutationFn: (actionId: string) => {
      return sdk.client.fetch(`/partners/returns/${id}/dismiss-items/${actionId}`, { method: "DELETE" })
    },
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

export const useConfirmReturnReceive = (
  id: string,
  orderId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminReturnResponse,
    FetchError,
    HttpTypes.AdminConfirmReceiveReturn
  >
) => {
  return useMutation({
    mutationFn: (payload: HttpTypes.AdminConfirmReceiveReturn) =>
      sdk.client.fetch(`/partners/returns/${id}/receive/confirm`, { method: "POST", body: payload }),
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
      queryClient.invalidateQueries({
        queryKey: returnsQueryKeys.lists(),
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useCancelReceiveReturn = (
  id: string,
  orderId: string,
  options?: UseMutationOptions<HttpTypes.AdminReturnResponse, FetchError>
) => {
  return useMutation({
    mutationFn: () =>
      sdk.client.fetch(`/partners/returns/${id}/receive/cancel`, { method: "POST" }),
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.details(),
      })

      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.preview(orderId),
        refetchType: "all", // We want preview to be updated in the cache immediately
      })

      queryClient.invalidateQueries({
        queryKey: returnsQueryKeys.details(),
      })
      queryClient.invalidateQueries({
        queryKey: returnsQueryKeys.lists(),
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}
