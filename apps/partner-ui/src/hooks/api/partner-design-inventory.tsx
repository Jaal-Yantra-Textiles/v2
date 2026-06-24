import { FetchError } from "@medusajs/js-sdk"
import {
  QueryKey,
  UseMutationOptions,
  UseQueryOptions,
  useMutation,
  useQuery,
} from "@tanstack/react-query"

import { sdk } from "../../lib/client"
import { firstMediaUrl } from "../../lib/first-media-url"
import { queryClient } from "../../lib/query-client"
import { partnerDesignsQueryKeys } from "./partner-designs"

/**
 * Roadmap #6 Phase 2 — partner design ↔ inventory BOM.
 * Wires GET/POST/PATCH/DELETE /partners/designs/:id/inventory[...].
 */

export type PartnerDesignBomMedia = {
  url?: string
  isThumbnail?: boolean
} & Record<string, any>

export type PartnerDesignRawMaterial = Record<string, any> & {
  id: string
  name?: string | null
  composition?: string | null
  color?: string | null
  unit_of_measure?: string | null
  media?: PartnerDesignBomMedia[] | null
}

export type PartnerDesignInventoryItem = Record<string, any> & {
  id: string
  inventory_item_id: string
  planned_quantity?: number | null
  consumed_quantity?: number | null
  location_id?: string | null
  inventory_item?: Record<string, any> & {
    id: string
    sku?: string | null
    title?: string | null
    raw_materials?: PartnerDesignRawMaterial[]
  }
}

export type PartnerDesignInventoryResponse = {
  inventory_items: PartnerDesignInventoryItem[]
}

const inventoryKey = (designId: string) => [
  "partner-design-inventory",
  designId,
]

export const usePartnerDesignInventory = (
  designId: string,
  options?: Omit<
    UseQueryOptions<
      PartnerDesignInventoryResponse,
      FetchError,
      PartnerDesignInventoryResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: inventoryKey(designId),
    queryFn: async () =>
      sdk.client.fetch<PartnerDesignInventoryResponse>(
        `/partners/designs/${designId}/inventory`,
        { method: "GET" }
      ),
    ...options,
  })
  return {
    inventory_items: data?.inventory_items ?? [],
    ...rest,
  }
}

/**
 * Raw-material catalog (admin-maintained, shared) for the BOM picker.
 * GET /partners/inventory-items/raw-materials returns link rows
 * { inventory_item, raw_materials }; we flatten to one row per item.
 */
export type PartnerRawMaterialRow = {
  id: string // inventory_item.id — what gets linked into the BOM
  sku?: string | null
  title?: string | null
  raw_material_name?: string | null
  composition?: string | null
  color?: string | null
  unit_of_measure?: string | null
  media_url?: string | null
}

const normalizeRawMaterialRow = (row: any): PartnerRawMaterialRow => {
  const inv = row?.inventory_item || {}
  const rm = Array.isArray(row?.raw_materials)
    ? row.raw_materials[0]
    : row?.raw_materials || {}
  return {
    id: inv.id ?? row?.inventory_item_id,
    sku: inv.sku ?? null,
    title: inv.title ?? null,
    raw_material_name: rm?.name ?? null,
    composition: rm?.composition ?? null,
    color: rm?.color ?? null,
    unit_of_measure: rm?.unit_of_measure ?? null,
    media_url:
      firstMediaUrl(rm?.media) ?? firstMediaUrl(inv?.metadata?.media) ?? null,
  }
}

export const usePartnerRawMaterials = (
  params?: { q?: string; limit?: number; offset?: number },
  options?: Omit<
    UseQueryOptions<
      { inventory_items: any[]; count: number },
      FetchError,
      { inventory_items: any[]; count: number },
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: ["partner-raw-materials", params],
    queryFn: async () => {
      const search = new URLSearchParams()
      if (params?.q) search.set("q", params.q)
      if (params?.limit != null) search.set("limit", String(params.limit))
      if (params?.offset != null) search.set("offset", String(params.offset))
      const qs = search.toString()
      return sdk.client.fetch<{ inventory_items: any[]; count: number }>(
        `/partners/inventory-items/raw-materials${qs ? `?${qs}` : ""}`,
        { method: "GET" }
      )
    },
    ...options,
  })
  return {
    raw_materials: (data?.inventory_items ?? []).map(normalizeRawMaterialRow),
    count: data?.count ?? 0,
    ...rest,
  }
}

export type LinkInventoryItemPayload = {
  inventoryItems: Array<{
    inventoryId: string
    plannedQuantity?: number
    locationId?: string
  }>
}

export const useLinkPartnerDesignInventory = (
  designId: string,
  options?: UseMutationOptions<
    PartnerDesignInventoryResponse,
    FetchError,
    LinkInventoryItemPayload
  >
) => {
  return useMutation({
    mutationFn: async (payload) =>
      sdk.client.fetch<PartnerDesignInventoryResponse>(
        `/partners/designs/${designId}/inventory`,
        { method: "POST", body: payload }
      ),
    onSuccess: async (data, variables, context) => {
      await queryClient.invalidateQueries({ queryKey: inventoryKey(designId) })
      await queryClient.invalidateQueries({
        queryKey: partnerDesignsQueryKeys.detail(designId),
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useUpdatePartnerDesignInventoryLink = (
  designId: string,
  inventoryItemId: string,
  options?: UseMutationOptions<
    PartnerDesignInventoryResponse,
    FetchError,
    { plannedQuantity?: number | null; locationId?: string | null }
  >
) => {
  return useMutation({
    mutationFn: async (payload) =>
      sdk.client.fetch<PartnerDesignInventoryResponse>(
        `/partners/designs/${designId}/inventory/${inventoryItemId}`,
        { method: "PATCH", body: payload }
      ),
    onSuccess: async (data, variables, context) => {
      await queryClient.invalidateQueries({ queryKey: inventoryKey(designId) })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useDelinkPartnerDesignInventory = (
  designId: string,
  options?: UseMutationOptions<
    PartnerDesignInventoryResponse,
    FetchError,
    { inventoryIds: string[] }
  >
) => {
  return useMutation({
    mutationFn: async (payload) =>
      sdk.client.fetch<PartnerDesignInventoryResponse>(
        `/partners/designs/${designId}/inventory/delink`,
        { method: "DELETE", body: payload }
      ),
    onSuccess: async (data, variables, context) => {
      await queryClient.invalidateQueries({ queryKey: inventoryKey(designId) })
      await queryClient.invalidateQueries({
        queryKey: partnerDesignsQueryKeys.detail(designId),
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}
