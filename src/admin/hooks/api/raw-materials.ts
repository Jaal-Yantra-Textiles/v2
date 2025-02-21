import { QueryKey, useMutation, UseMutationOptions, useQuery, useQueryClient, UseQueryOptions } from "@tanstack/react-query"
import { sdk } from "../../lib/sdk"
import { FetchError } from "@medusajs/js-sdk"
import { queryKeysFactory } from "../../lib/query-key-factory";

import { HttpTypes } from "@medusajs/framework/types";

export interface CreateRawMaterialInput {
  rawMaterialData: {
    name: string
  description: string
  composition: string
  unit_of_measure?: "Meter" | "Yard" | "Kilogram" | "Gram" | "Piece" | "Roll" | "Other"
  minimum_order_quantity?: number
  lead_time_days?: number
  color?: string
  width?: string
  weight?: string
  grade?: string
  certification?: Record<string, any>
  usage_guidelines?: string
  storage_requirements?: string
  status?: "Active" | "Discontinued" | "Under_Review" | "Development"
  material_type?: {
    name: string
    description?: string
    category?: "Fiber" | "Yarn" | "Fabric" | "Trim" | "Dye" | "Chemical" | "Accessory" | "Other"
    properties?: Record<string, any>
  }
  }
}

export interface MaterialType {
  id: string
  name: string
  description: string | null
  category: "Fiber" | "Yarn" | "Fabric" | "Trim" | "Dye" | "Chemical" | "Accessory" | "Other"
  properties: any | null
  metadata: any | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface RawMaterial {
  id: string
  name: string
  description: string
  composition: string
  specifications: any | null
  unit_of_measure: "Meter" | "Yard" | "Kilogram" | "Gram" | "Piece" | "Roll" | "Other"
  minimum_order_quantity: number
  lead_time_days: number
  color: string
  width: string
  weight: string
  grade: string
  certification: any | null
  usage_guidelines: string | null
  storage_requirements: string | null
  status: "Active" | "Discontinued" | "Under_Review" | "Development"
  metadata: any | null
  material_type_id: string
  created_at: string
  updated_at: string
  deleted_at: string | null
  material_type: MaterialType
}

export interface InventoryItem {
  id: string
  sku: string
  origin_country: string | null
  hs_code: string | null
  mid_code: string | null
  material: string | null
  weight: string | null
  length: string | null
  height: string | null
  width: string | null
  requires_shipping: boolean
  description: string
  title: string
  thumbnail: string | null
  metadata: any | null
  created_at: string
  updated_at: string
  deleted_at: string | null
  raw_materials?: RawMaterial
  location_levels: Array<{
    id: string
    inventory_item_id: string
    location_id: string
    stocked_quantity: number
    reserved_quantity: number
    incoming_quantity: number
    metadata: any | null
    created_at: string
    updated_at: string
    deleted_at: string | null
  }>
}

export interface InventoryItemsResponse {
  inventory_items: InventoryItem[]
}

export interface InventoryItemResponse {
  inventory_item: InventoryItem
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
      InventoryItemResponse,
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

export const useInventoryItems = (
  query?: HttpTypes.AdminInventoryItemParams,
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminInventoryItemListResponse,
      FetchError,
      InventoryItemsResponse,
      QueryKey
    >,
    "queryKey" | "queryFn"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () => sdk.admin.inventoryItem.list(query),
    queryKey: inventoryItemsRawMaterialQueryKeys.list(query),
    ...options,
  })

  return { ...data, ...rest }
}



export const useCreateRawMaterial = (
  inventoryId: string,
  options?: UseMutationOptions<
    InventoryItem,
    FetchError,
    CreateRawMaterialInput
  >
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: CreateRawMaterialInput) => {
      const  response  = await sdk.client.fetch<InventoryItem>(
        `/admin/inventory-items/${inventoryId}/rawmaterials`,
        {
          method: "POST",
          body: payload
        }
      )
      return response
    },
    onSuccess: async (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: ["raw-materials"],
      })
      options?.onSuccess?.(data, variables, context)
    },
  })
}