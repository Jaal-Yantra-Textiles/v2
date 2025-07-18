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
    queryKey: productsQueryKeys.detail(id),
    ...options,
  })

  return { ...data, ...rest }
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
