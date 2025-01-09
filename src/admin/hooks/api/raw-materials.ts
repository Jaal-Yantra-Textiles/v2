import { QueryKey, useMutation, UseMutationOptions, useQuery, useQueryClient, UseQueryOptions } from "@tanstack/react-query"
import { sdk } from "../../lib/sdk"
import { CreateRawMaterialInput, RawMaterial } from "./medusa"
import { FetchError } from "@medusajs/js-sdk"
import { queryKeysFactory } from "../../lib/query-key-factory";

import { HttpTypes } from "@medusajs/framework/types";

interface RawMaterialResponse {
  inventory_item: {
    id: string;
    sku: string;
    origin_country: string | null;
    hs_code: string | null;
    mid_code: string | null;
    material: string | null;
    weight: string | null;
    length: string | null;
    height: string | null;
    width: string | null;
    requires_shipping: boolean;
    description: string;
    title: string;
    thumbnail: string | null;
    metadata: any | null;
    created_at: string;
    updated_at: string;
    deleted_at: string | null
    raw_materials: RawMaterial;
    location_levels: [{}]
  }
}

const INVENTORY_ITEMS_RAW_MATERIAL_QUERY_KEY = "inventory_items_raw_materials" as const
export const inventoryItemsRawMaterialQueryKeys = queryKeysFactory(
  INVENTORY_ITEMS_RAW_MATERIAL_QUERY_KEY
)

export const useInventoryItem = (
  id: string,
  query?: Record<string, any>,
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminInventoryItemResponse,
      FetchError,
      RawMaterialResponse,
      QueryKey
    >,
    "queryKey" | "queryFn"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () => sdk.admin.inventoryItem.retrieve(id, query),
    queryKey: inventoryItemsRawMaterialQueryKeys.detail(id),
    ...options,
  })

  return { ...data, ...rest }
}


export const useCreateRawMaterial = (
  inventoryId: string,
  options?: UseMutationOptions<
    RawMaterial,
    FetchError,
    CreateRawMaterialInput
  >
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: CreateRawMaterialInput) => {
      const  response  = await sdk.client.fetch<RawMaterialResponse>(
        `/admin/inventory-items/${inventoryId}/rawmaterials`,
        {
          method: "POST",
          body: payload
        }
      )
      return response.raw_materials
    },
    onSuccess: async (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: ["raw-materials"],
      })
      options?.onSuccess?.(data, variables, context)
    },
  })
}