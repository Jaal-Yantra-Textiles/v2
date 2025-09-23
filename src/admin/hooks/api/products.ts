import { FetchError } from "@medusajs/js-sdk";
import { HttpTypes } from "@medusajs/types";
import {
  QueryKey,
  useQuery,
  UseQueryOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { sdk } from "../../lib/config";
import { queryKeysFactory } from "../../lib/query-key-factory";
import { toast } from "@medusajs/ui";

const PRODUCTS_QUERY_KEY = "products-from-admin" as const;
export const productsQueryKeys = {
  ...queryKeysFactory(PRODUCTS_QUERY_KEY),
  // Add any specific product query key patterns here if needed, e.g., detail(id: string)
};

export const useProducts = (
  query?: HttpTypes.AdminProductListParams,
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminProductListResponse,
      FetchError,
      HttpTypes.AdminProductListResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () => sdk.admin.product.list(query),
    queryKey: productsQueryKeys.list(query),
    ...options,
  });

  // The 'data' object here will be of type HttpTypes.AdminProductListResponse | undefined
  // It contains: products, count, limit, offset
  return { ...data, ...rest };
};

// useProduct hook similar to useInventoryItem
export const useProduct = (
  id: string,
  query?: Record<string, any>,
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminProductResponse,
      FetchError,
      HttpTypes.AdminProductResponse,
      QueryKey
    >,
    "queryKey" | "queryFn"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () => sdk.admin.product.retrieve(id, query),
    // Include query in the key to avoid cache collisions across different field expansions
    queryKey: productsQueryKeys.detail(id, query),
    ...options,
  })

  return { ...data, ...rest }
}

// Product-Person linking hooks
type LinkPersonPayload = {
  personId: string
}

type UnlinkPersonPayload = {
  personId: string
}

export const useLinkProductPerson = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ productId, payload }: { productId: string; payload: LinkPersonPayload }) => {
      const response = await fetch(`/admin/products/${productId}/linkPerson`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || "Failed to link person to product")
      }

      return response.json()
    },
    onSuccess: async (data, { productId }) => {
      // If API returned the updated product, seed all cached detail variants immediately for a snappy UI
      if (data?.product) {
        queryClient.setQueryData(productsQueryKeys.detail(productId), { product: data.product })
        queryClient.setQueriesData({ queryKey: productsQueryKeys.details() }, (old: any) => {
          if (!old) return old
          // Old response shape is { product: ... }
          if (old.product?.id === data.product.id) {
            return { ...old, product: data.product }
          }
          return old
        })
      }
      // Invalidate and refetch product data
      queryClient.invalidateQueries({ queryKey: productsQueryKeys.detail(productId) })
      // Invalidate all detail variants (different field expansions)
      queryClient.invalidateQueries({ queryKey: productsQueryKeys.details() })
      queryClient.invalidateQueries({ queryKey: productsQueryKeys.lists() })
      toast.success("Person linked to product successfully")
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to link person to product")
    },
  })
}

export const useUnlinkProductPerson = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ productId, payload }: { productId: string; payload: UnlinkPersonPayload }) => {
      const response = await fetch(`/admin/products/${productId}/unlinkPerson`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || "Failed to unlink person from product")
      }

      return response.json()
    },
    onSuccess: async (data, { productId }) => {
      // If API returned the updated product, seed all cached detail variants immediately
      if (data?.product) {
        queryClient.setQueryData(productsQueryKeys.detail(productId), { product: data.product })
        queryClient.setQueriesData({ queryKey: productsQueryKeys.details() }, (old: any) => {
          if (!old) return old
          if (old.product?.id === data.product.id) {
            return { ...old, product: data.product }
          }
          return old
        })
      }
      // Invalidate and refetch product data
      queryClient.invalidateQueries({ queryKey: productsQueryKeys.detail(productId) })
      // Invalidate all detail variants (different field expansions)
      queryClient.invalidateQueries({ queryKey: productsQueryKeys.details() })
      queryClient.invalidateQueries({ queryKey: productsQueryKeys.lists() })
      toast.success("Person unlinked from product successfully")
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to unlink person from product")
    },
  })
}

// Product-Design linking hooks
type LinkDesignPayload = {
  designId: string
}

type UnlinkDesignPayload = {
  designId: string
}

export const useLinkProductDesign = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ productId, payload }: { productId: string; payload: LinkDesignPayload }) => {
      const response = await fetch(`/admin/products/${productId}/linkDesign`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || "Failed to link design to product")
      }

      return response.json()
    },
    onSuccess: (_, { productId }) => {
      // Invalidate and refetch product data
      queryClient.invalidateQueries({ queryKey: productsQueryKeys.detail(productId) })
      queryClient.invalidateQueries({ queryKey: productsQueryKeys.lists() })
      toast.success("Design linked to product successfully")
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to link design to product")
    },
  })
}

export const useUnlinkProductDesign = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ productId, payload }: { productId: string; payload: UnlinkDesignPayload }) => {
      const response = await fetch(`/admin/products/${productId}/unlinkDesign`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || "Failed to unlink design from product")
      }

      return response.json()
    },
    onSuccess: (_, { productId }) => {
      // Invalidate and refetch product data
      queryClient.invalidateQueries({ queryKey: productsQueryKeys.detail(productId) })
      queryClient.invalidateQueries({ queryKey: productsQueryKeys.lists() })
      toast.success("Design unlinked from product successfully")
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to unlink design from product")
    },
  })
}
