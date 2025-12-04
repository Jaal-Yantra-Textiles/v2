"use server"

import { sdk } from "@lib/config"
import { getAuthHeaders, getCacheOptions } from "./cookies"

// Layer type for canvas elements
export type DesignLayer = {
  id: string
  type: "image" | "text"
  x: number
  y: number
  width?: number
  height?: number
  rotation: number
  scaleX: number
  scaleY: number
  src?: string
  text?: string
  fontSize?: number
  fontFamily?: string
  fontStyle?: string
  fill?: string
  opacity: number
}

// Design metadata structure
export type DesignMetadata = {
  layers?: DesignLayer[]
  base_product_id?: string
  base_product_thumbnail?: string
  [key: string]: any
}

// Full design type
export type Design = {
  id: string
  name: string
  description?: string
  status?: string
  thumbnail_url?: string
  metadata?: DesignMetadata
  inventory_items?: Array<{
    id: string
    title?: string
  }>
  partners?: Array<{
    id: string
    name?: string
  }>
  created_at?: string
}

// Request body for creating a design
export type CreateDesignInput = {
  name: string
  description?: string
  thumbnail_url?: string
  metadata?: DesignMetadata
  inventory_ids?: string[]
  partner_id?: string
  color_palette?: Array<{ name: string; code: string }>
  custom_sizes?: Record<string, Record<string, number>>
  tags?: string[]
}

// Response types
export type CreateDesignResponse = {
  design: Design
  linked_inventory: any
  linked_partner: any
}

export type ListDesignsResponse = {
  designs: Design[]
  count: number
  offset: number
  limit: number
}

/**
 * Creates a custom design with optional inventory and partner linking
 */
export const createDesign = async (
  input: CreateDesignInput
): Promise<CreateDesignResponse> => {
  const headers = {
    ...(await getAuthHeaders()),
    "Content-Type": "application/json",
  }

  try {
    const data = await sdk.client.fetch<CreateDesignResponse>(
      `/store/custom/designs`,
      {
        method: "POST",
        body: input,
        headers,
      }
    )

    return data
  } catch (error) {
    console.error("Error creating design:", error)
    throw error
  }
}

/**
 * Lists customer designs
 */
export const listDesigns = async ({
  limit = 20,
  offset = 0,
}: {
  limit?: number
  offset?: number
} = {}): Promise<ListDesignsResponse> => {
  const headers = {
    ...(await getAuthHeaders()),
  }

  const next = {
    ...(await getCacheOptions("designs")),
  }

  try {
    const data = await sdk.client.fetch<ListDesignsResponse>(
      `/store/custom/designs`,
      {
        method: "GET",
        query: {
          limit,
          offset,
        },
        headers,
        next,
        cache: "force-cache",
      }
    )

    return {
      designs: data.designs || [],
      count: data.count || 0,
      offset: data.offset || offset,
      limit: data.limit || limit,
    }
  } catch (error) {
    console.error("Error fetching designs:", error)
    return {
      designs: [],
      count: 0,
      offset,
      limit,
    }
  }
}
