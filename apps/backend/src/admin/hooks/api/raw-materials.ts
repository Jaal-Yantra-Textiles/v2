import { QueryKey, useMutation, UseMutationOptions, useQuery, useQueryClient, UseQueryOptions } from "@tanstack/react-query"
import { sdk } from "../../lib/config"
import { FetchError } from "@medusajs/js-sdk"
import { queryKeysFactory } from "../../lib/query-key-factory";

import { HttpTypes } from "@medusajs/framework/types";

export interface RawMaterialData {
  name: string
  description: string
  composition: string
  unit_of_measure?: "Meter" | "Yard" | "Kilogram" | "Gram" | "Piece" | "Roll" | "Other"
  unit_cost?: number
  cost_currency?: string
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
  media?: Record<string, any>
}

export interface CreateRawMaterialInput {
  rawMaterialData: RawMaterialData
}

export interface UpdateRawMaterialInput {
  rawMaterialData: RawMaterialData
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
  unit_cost: number | null
  cost_currency: string | null
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
  media: Record<string, any>
}

export interface InventoryItem {
  id: string
  inventory_item_id?: string // Added for link-based queries
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
  inventory_item?: InventoryItem // Added for link-based queries
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
  query?: HttpTypes.AdminInventoryItemsParams,
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
      // Invalidate the specific inventory item query
      queryClient.invalidateQueries({
        queryKey: inventoryItemsRawMaterialQueryKeys.detail(inventoryId),
      })
      
      // Invalidate the inventory items list query
      queryClient.invalidateQueries({
        queryKey: inventoryItemsRawMaterialQueryKeys.list(),
      })
      
      // Also keep the raw-materials invalidation for backward compatibility
      queryClient.invalidateQueries({
        queryKey: ["raw-materials"],
      })
      
      options?.onSuccess?.(data, variables, undefined, context as any)
    },
  })
}

export const useUpdateRawMaterial = (
  inventoryId: string,
  materialId: string,
  options?: UseMutationOptions<
    InventoryItem,
    FetchError,
    UpdateRawMaterialInput
  >
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: UpdateRawMaterialInput) => {
      const response = await sdk.client.fetch<InventoryItem>(
        `/admin/inventory-items/${inventoryId}/rawmaterials/${materialId}`,
        {
          method: "PUT",
          body: payload
        }
      )
      return response
    },
    onSuccess: async (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: inventoryItemsRawMaterialQueryKeys.detail(inventoryId),
      })
      
      // Invalidate the inventory items list query
      queryClient.invalidateQueries({
        queryKey: inventoryItemsRawMaterialQueryKeys.list(),
      })
      
      // Also keep the raw-materials invalidation for backward compatibility
      queryClient.invalidateQueries({
        queryKey: ["raw-materials"],
      })
      queryClient.invalidateQueries({
        queryKey: ["raw-materials", inventoryId, materialId],
      })
      options?.onSuccess?.(data, variables, undefined, context as any)
    },
  })
}

type RawMaterialCategoriesParams = {
  limit?: number;
  offset?: number;
  name?: string;
  created_at?: Record<string, Date>;
  updated_at?: Record<string, Date>;
};



export interface RawMaterialCategory {
  id: string;
  name: string;
  description?: string;
  category: "Fiber" | "Yarn" | "Fabric" | "Trim" | "Dye" | "Chemical" | "Accessory" | "Other";
  metadata?: Record<string, any>;
  properties?: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export interface RawMaterialCategoriesResponse {
  categories: RawMaterialCategory[];
  count: number;
  offset: number;
  limit: number;
}

export const useRawMaterialCategories = (
  params: RawMaterialCategoriesParams,
  options?: Omit<
    UseQueryOptions<
     RawMaterialCategoriesResponse,
      FetchError,
      RawMaterialCategoriesResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >,
) => {
  const { data, ...rest } = useQuery({
    // Include params in the key — a static key meant changing the search
    // term never refetched, so server-side category search silently
    // returned stale results (part of roadmap bug #1).
    queryKey: [...inventoryItemsRawMaterialQueryKeys.lists(), params],
    queryFn: async () =>
      sdk.client.fetch<RawMaterialCategoriesResponse>(
        `/admin/categories/rawmaterials`,
        {
          method: "GET",
          query: params,
        },
      ),
    ...options,
  });
  return { ...data, ...rest };
}

export const useRawMaterial = (
  inventoryId: string,
  materialId: string,
  options?: UseQueryOptions<InventoryItem, FetchError>
) => {
  return useQuery<InventoryItem, FetchError>({
    queryKey: ["raw-materials", inventoryId, materialId],
    queryFn: async () => {
      const response = await sdk.client.fetch<InventoryItem>(
        `/admin/inventory-items/${inventoryId}/rawmaterials/${materialId}`
      );
      return response;
    },
    ...options,
  });
};

export interface InventoryWithRawMaterialsResponse {
  inventory_items: InventoryItem[]
  count?: number
  offset?: number
  limit?: number
}

export interface SplitInventoryItemPayload {
  quantity: number
  new_title: string
  /** When set, split is taken from this location only. */
  location_id?: string
  raw_material_overrides?: {
    name?: string
    color?: string
    composition?: string
    grade?: string
    description?: string
    extra?: Record<string, string>
  }
}

export interface SplitInventoryItemResponse {
  inventory_item: { id: string; title: string }
  raw_material: { id: string; name: string } | null
}

export const useSplitInventoryItem = (
  inventoryItemId: string,
  options?: UseMutationOptions<
    SplitInventoryItemResponse,
    FetchError,
    SplitInventoryItemPayload
  >
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: SplitInventoryItemPayload) => {
      const response = await sdk.client.fetch<SplitInventoryItemResponse>(
        `/admin/inventory-items/${inventoryItemId}/split`,
        {
          method: "POST",
          body: payload,
        }
      )
      return response
    },
    onSuccess: async (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: inventoryItemsRawMaterialQueryKeys.detail(inventoryItemId),
      })
      queryClient.invalidateQueries({
        queryKey: inventoryItemsRawMaterialQueryKeys.list(),
      })
      options?.onSuccess?.(data, variables, undefined, context as any)
    },
  })
}

export const useInventoryWithRawMaterials = (
  query?: Record<string, any>,
  options?: Omit<
    UseQueryOptions<
      InventoryWithRawMaterialsResponse,
      FetchError,
      InventoryWithRawMaterialsResponse,
      QueryKey
    >,
    "queryKey" | "queryFn"
  >
) => {
  const { data, ...rest } = useQuery<InventoryWithRawMaterialsResponse, FetchError, InventoryWithRawMaterialsResponse, QueryKey>({
    queryKey: inventoryItemsRawMaterialQueryKeys.list(query),
    queryFn: async () => {
      const response = await sdk.client.fetch<InventoryWithRawMaterialsResponse>(
        `/admin/inventory-items/raw-materials`,
        {
          method: "GET",
          query
        }
      );
      return response;
    },
    ...options,
  });
  
  return { ...data, ...rest };
};

// Page size used when auto-paginating the raw-materials catalog. The endpoint
// loads the full set server-side then slices, so this only bounds the number
// of round-trips — 200 keeps payload sizes modest while capping fetches at
// ~ceil(count/200) for very large catalogs.
const RAW_MATERIALS_FETCH_ALL_PAGE_SIZE = 200

// Fetch-all variant: pages through /admin/inventory-items/raw-materials until
// the true `count` is reached, eliminating the silent truncation a single
// `limit:1000` page introduced once the catalog grows past it. Returns a shape
// matching the single-page hook so callers (order-lines pickers) can swap in
// unchanged. #947
export const useAllInventoryWithRawMaterials = (
  baseQuery?: Record<string, any>,
  options?: Omit<
    UseQueryOptions<
      InventoryWithRawMaterialsResponse,
      FetchError,
      InventoryWithRawMaterialsResponse,
      QueryKey
    >,
    "queryKey" | "queryFn"
  >
) => {
  const query = { ...(baseQuery ?? {}) }
  delete query.limit
  delete query.offset

  const { data, ...rest } = useQuery<
    InventoryWithRawMaterialsResponse,
    FetchError,
    InventoryWithRawMaterialsResponse,
    QueryKey
  >({
    queryKey: [
      ...inventoryItemsRawMaterialQueryKeys.lists(),
      "all",
      query,
    ],
    queryFn: async () => {
      const accumulated: InventoryItem[] = []
      let offset = 0
      // Upper bound on iterations to guard against a misbehaving endpoint.
      const maxPages = 500
      for (let page = 0; page < maxPages; page++) {
        const res = await sdk.client.fetch<InventoryWithRawMaterialsResponse>(
          `/admin/inventory-items/raw-materials`,
          {
            method: "GET",
            query: {
              ...query,
              limit: RAW_MATERIALS_FETCH_ALL_PAGE_SIZE,
              offset,
            },
          }
        )
        const batch = res.inventory_items ?? []
        accumulated.push(...batch)
        const total = res.count ?? accumulated.length
        offset += batch.length
        if (batch.length === 0 || offset >= total) {
          break
        }
      }
      return {
        inventory_items: accumulated,
        count: accumulated.length,
        offset: 0,
        limit: accumulated.length,
      }
    },
    ...options,
  })

  return { ...data, ...rest }
};