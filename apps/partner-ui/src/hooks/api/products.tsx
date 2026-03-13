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
import { inventoryItemsQueryKeys } from "./inventory.tsx"
import { usePartnerStores } from "./partner-stores"

const PRODUCTS_QUERY_KEY = "products" as const
export const productsQueryKeys = queryKeysFactory(PRODUCTS_QUERY_KEY)

const VARIANTS_QUERY_KEY = "product_variants" as const
export const variantsQueryKeys = queryKeysFactory(VARIANTS_QUERY_KEY)

const OPTIONS_QUERY_KEY = "product_options" as const
export const optionsQueryKeys = queryKeysFactory(OPTIONS_QUERY_KEY)

export const useCreateProductOption = (
  productId: string,
  options?: UseMutationOptions<any, FetchError, any>
) => {
  const { stores } = usePartnerStores()
  const storeId = stores?.[0]?.id

  return useMutation({
    mutationFn: (payload: HttpTypes.AdminCreateProductOption) =>
      sdk.client.fetch<any>(
        `/partners/stores/${storeId}/products/${productId}/options`,
        { method: "POST", body: payload }
      ),
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({ queryKey: optionsQueryKeys.lists() })
      queryClient.invalidateQueries({
        queryKey: productsQueryKeys.detail(productId),
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useUpdateProductOption = (
  productId: string,
  optionId: string,
  options?: UseMutationOptions<any, FetchError, any>
) => {
  const { stores } = usePartnerStores()
  const storeId = stores?.[0]?.id

  return useMutation({
    mutationFn: (payload: HttpTypes.AdminUpdateProductOption) =>
      sdk.client.fetch<any>(
        `/partners/stores/${storeId}/products/${productId}/options/${optionId}`,
        { method: "POST", body: payload }
      ),
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({ queryKey: optionsQueryKeys.lists() })
      queryClient.invalidateQueries({
        queryKey: optionsQueryKeys.detail(optionId),
      })
      queryClient.invalidateQueries({
        queryKey: productsQueryKeys.detail(productId),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useDeleteProductOption = (
  productId: string,
  optionId: string,
  options?: UseMutationOptions<any, FetchError, void>
) => {
  const { stores } = usePartnerStores()
  const storeId = stores?.[0]?.id

  return useMutation({
    mutationFn: () =>
      sdk.client.fetch<any>(
        `/partners/stores/${storeId}/products/${productId}/options/${optionId}`,
        { method: "DELETE" }
      ),
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({ queryKey: optionsQueryKeys.lists() })
      queryClient.invalidateQueries({
        queryKey: optionsQueryKeys.detail(optionId),
      })
      queryClient.invalidateQueries({
        queryKey: productsQueryKeys.detail(productId),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useProductVariant = (
  productId: string,
  variantId: string,
  query?: HttpTypes.AdminProductVariantParams,
  options?: Omit<
    UseQueryOptions<
      { variant: any },
      FetchError,
      { variant: any },
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { stores } = usePartnerStores()
  const storeId = stores?.[0]?.id

  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<{ variant: any }>(
        `/partners/stores/${storeId}/products/${productId}/variants/${variantId}`,
        { method: "GET" }
      ),
    queryKey: variantsQueryKeys.detail(variantId, query),
    enabled: !!storeId && (options?.enabled !== false),
    ...options,
  })

  return { ...data, ...rest }
}

export const useProductVariants = (
  productId: string,
  query?: HttpTypes.AdminProductVariantParams,
  options?: Omit<
    UseQueryOptions<
      { variants: any[]; count: number },
      FetchError,
      { variants: any[]; count: number },
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { stores } = usePartnerStores()
  const storeId = stores?.[0]?.id

  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<{ variants: any[]; count: number }>(
        `/partners/stores/${storeId}/products/${productId}/variants`,
        { method: "GET" }
      ),
    queryKey: variantsQueryKeys.list({ productId, ...query }),
    enabled: !!storeId && (options?.enabled !== false),
    ...options,
  })

  return { ...data, ...rest }
}

export const useCreateProductVariant = (
  productId: string,
  options?: UseMutationOptions<any, FetchError, any>
) => {
  const { stores } = usePartnerStores()
  const storeId = stores?.[0]?.id

  return useMutation({
    mutationFn: (payload: HttpTypes.AdminCreateProductVariant) =>
      sdk.client.fetch<any>(
        `/partners/stores/${storeId}/products/${productId}/variants`,
        { method: "POST", body: payload }
      ),
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({ queryKey: variantsQueryKeys.lists() })
      queryClient.invalidateQueries({
        queryKey: productsQueryKeys.detail(productId),
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useUpdateProductVariant = (
  productId: string,
  variantId: string,
  options?: UseMutationOptions<any, FetchError, any>
) => {
  const { stores } = usePartnerStores()
  const storeId = stores?.[0]?.id

  return useMutation({
    mutationFn: (payload: HttpTypes.AdminUpdateProductVariant) =>
      sdk.client.fetch<any>(
        `/partners/stores/${storeId}/products/${productId}/variants/${variantId}`,
        { method: "POST", body: payload }
      ),
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({ queryKey: variantsQueryKeys.lists() })
      queryClient.invalidateQueries({
        queryKey: variantsQueryKeys.detail(variantId),
      })
      queryClient.invalidateQueries({
        queryKey: productsQueryKeys.detail(productId),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useUpdateProductVariantsBatch = (
  productId: string,
  options?: UseMutationOptions<any, FetchError, any>
) => {
  return useMutation({
    mutationFn: (
      payload: HttpTypes.AdminBatchProductVariantRequest["update"]
    ) =>
      sdk.admin.product.batchVariants(productId, {
        update: payload,
      }),
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({ queryKey: variantsQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: variantsQueryKeys.details() })
      queryClient.invalidateQueries({
        queryKey: productsQueryKeys.detail(productId),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useProductVariantsInventoryItemsBatch = (
  productId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminBatchProductVariantInventoryItemResponse,
    FetchError,
    HttpTypes.AdminBatchProductVariantInventoryItemRequest
  >
) => {
  return useMutation({
    mutationFn: (payload) =>
      sdk.admin.product.batchVariantInventoryItems(productId, payload),
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({ queryKey: variantsQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: variantsQueryKeys.details() })
      queryClient.invalidateQueries({
        queryKey: productsQueryKeys.detail(productId),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useDeleteVariant = (
  productId: string,
  variantId: string,
  options?: UseMutationOptions<any, FetchError, void>
) => {
  const { stores } = usePartnerStores()
  const storeId = stores?.[0]?.id

  return useMutation({
    mutationFn: () =>
      sdk.client.fetch<any>(
        `/partners/stores/${storeId}/products/${productId}/variants/${variantId}`,
        { method: "DELETE" }
      ),
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({ queryKey: variantsQueryKeys.lists() })
      queryClient.invalidateQueries({
        queryKey: variantsQueryKeys.detail(variantId),
      })
      queryClient.invalidateQueries({
        queryKey: productsQueryKeys.detail(productId),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useDeleteVariantLazy = (
  productId: string,
  options?: UseMutationOptions<
    any,
    FetchError,
    { variantId: string }
  >
) => {
  const { stores } = usePartnerStores()
  const storeId = stores?.[0]?.id

  return useMutation({
    mutationFn: ({ variantId }) =>
      sdk.client.fetch<any>(
        `/partners/stores/${storeId}/products/${productId}/variants/${variantId}`,
        { method: "DELETE" }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: variantsQueryKeys.lists() })
      queryClient.invalidateQueries({
        queryKey: variantsQueryKeys.detail(variables.variantId),
      })
      queryClient.invalidateQueries({
        queryKey: productsQueryKeys.detail(productId),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useProduct = (
  id: string,
  query?: Record<string, any>,
  options?: Omit<
    UseQueryOptions<
      { product: any },
      FetchError,
      { product: any },
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { stores } = usePartnerStores()
  const storeId = stores?.[0]?.id

  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<{ product: any }>(
        `/partners/stores/${storeId}/products/${id}`,
        { method: "GET" }
      ),
    queryKey: productsQueryKeys.detail(id, query),
    enabled: !!storeId && (options?.enabled !== false),
    ...options,
  })

  return { ...data, ...rest }
}

export const useProducts = (
  query?: HttpTypes.AdminProductListParams,
  options?: Omit<
    UseQueryOptions<
      { products: any[]; count: number },
      FetchError,
      { products: any[]; count: number },
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { stores } = usePartnerStores()
  const storeId = stores?.[0]?.id

  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<{ products: any[]; count: number }>(
        `/partners/stores/${storeId}/products`,
        { method: "GET" }
      ),
    queryKey: productsQueryKeys.list(query),
    enabled: !!storeId && (options?.enabled !== false),
    ...options,
  })

  return { ...data, ...rest }
}

export const useCreateProduct = (
  options?: UseMutationOptions<
    { product: any },
    FetchError,
    HttpTypes.AdminCreateProduct
  >
) => {
  const { stores } = usePartnerStores()
  const storeId = stores?.[0]?.id

  return useMutation({
    mutationFn: (payload) =>
      sdk.client.fetch<{ product: any }>(
        `/partners/stores/${storeId}/products`,
        { method: "POST", body: payload }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: productsQueryKeys.lists() })
      queryClient.invalidateQueries({
        queryKey: inventoryItemsQueryKeys.lists(),
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useUpdateProduct = (
  id: string,
  options?: UseMutationOptions<
    { product: any },
    FetchError,
    HttpTypes.AdminUpdateProduct
  >
) => {
  const { stores } = usePartnerStores()
  const storeId = stores?.[0]?.id

  return useMutation({
    mutationFn: (payload) =>
      sdk.client.fetch<{ product: any }>(
        `/partners/stores/${storeId}/products/${id}`,
        { method: "POST", body: payload }
      ),
    onSuccess: async (data, variables, context) => {
      await queryClient.invalidateQueries({
        queryKey: productsQueryKeys.lists(),
      })
      await queryClient.invalidateQueries({
        queryKey: productsQueryKeys.detail(id),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useDeleteProduct = (
  id: string,
  options?: UseMutationOptions<
    { id: string; object: string; deleted: boolean },
    FetchError,
    void
  >
) => {
  const { stores } = usePartnerStores()
  const storeId = stores?.[0]?.id

  return useMutation({
    mutationFn: () =>
      sdk.client.fetch<{ id: string; object: string; deleted: boolean }>(
        `/partners/stores/${storeId}/products/${id}`,
        { method: "DELETE" }
      ),
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({ queryKey: productsQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: productsQueryKeys.detail(id) })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useExportProducts = (
  query?: HttpTypes.AdminProductListParams,
  options?: UseMutationOptions<
    HttpTypes.AdminExportProductResponse,
    FetchError,
    HttpTypes.AdminExportProductRequest
  >
) => {
  return useMutation({
    mutationFn: (payload) => sdk.admin.product.export(payload, query),
    onSuccess: (data, variables, context) => {
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useImportProducts = (
  options?: UseMutationOptions<
    HttpTypes.AdminImportProductResponse,
    FetchError,
    HttpTypes.AdminImportProductRequest
  >
) => {
  return useMutation({
    mutationFn: (payload) => sdk.admin.product.createImport(payload),
    onSuccess: (data, variables, context) => {
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useConfirmImportProducts = (
  options?: UseMutationOptions<{}, FetchError, string>
) => {
  return useMutation({
    mutationFn: (payload) => sdk.admin.product.confirmImport(payload),
    onSuccess: (data, variables, context) => {
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useBatchImageVariants = (
  productId: string,
  imageId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminBatchImageVariantResponse,
    FetchError,
    HttpTypes.AdminBatchImageVariantRequest
  >
) => {
  return useMutation({
    mutationFn: (payload) =>
      sdk.admin.product.batchImageVariants(productId, imageId, payload),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: productsQueryKeys.detail(productId),
      })
      queryClient.invalidateQueries({ queryKey: variantsQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: variantsQueryKeys.details() })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useBatchVariantImages = (
  productId: string,
  variantId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminBatchVariantImagesResponse,
    FetchError,
    HttpTypes.AdminBatchVariantImagesRequest
  >
) => {
  return useMutation({
    mutationFn: (payload) =>
      sdk.admin.product.batchVariantImages(productId, variantId, payload),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: productsQueryKeys.detail(productId),
      })
      queryClient.invalidateQueries({
        queryKey: variantsQueryKeys.list({ productId }),
      })
      queryClient.invalidateQueries({
        queryKey: variantsQueryKeys.detail(variantId),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}
