"use server"

import { sdk } from "@lib/config"
import { getAuthHeaders, getCacheOptions } from "./cookies"

export type RawMaterial = {
  id: string
  name?: string
  color?: string
  composition?: string
  media?: Array<{ url: string; isThumbnail?: boolean }> | null
  material_type?: {
    id: string
    name: string
    description?: string
    category?: string
  }
  inventory_item?: {
    id: string
    title?: string
    sku?: string
  }
}

export type ListRawMaterialsResponse = {
  raw_materials: RawMaterial[]
  count: number
  offset: number
  limit: number
}

/**
 * Fetches all raw materials from the store API
 * These are the available fabrics/materials that can be used in designs
 */
export const listRawMaterials = async ({
  limit = 50,
  offset = 0,
  q,
}: {
  limit?: number
  offset?: number
  q?: string
} = {}): Promise<ListRawMaterialsResponse> => {
  const headers = {
    ...(await getAuthHeaders()),
  }

  const next = {
    ...(await getCacheOptions("raw-materials")),
  }

  try {
    const data = await sdk.client.fetch<ListRawMaterialsResponse>(
      `/store/custom/raw-materials`,
      {
        method: "GET",
        query: {
          limit,
          offset,
          ...(q ? { q } : {}),
        },
        headers,
        next,
        cache: "force-cache",
      }
    )

    return {
      raw_materials: data.raw_materials || [],
      count: data.count || 0,
      offset: data.offset || offset,
      limit: data.limit || limit,
    }
  } catch (error) {
    console.error("Error fetching raw materials:", error)
    return {
      raw_materials: [],
      count: 0,
      offset,
      limit,
    }
  }
}

/**
 * Fetches a single raw material by ID
 */
export const getRawMaterial = async (id: string): Promise<RawMaterial | null> => {
  const { raw_materials } = await listRawMaterials({ limit: 100 })
  return raw_materials.find((rm) => rm.id === id) || null
}
