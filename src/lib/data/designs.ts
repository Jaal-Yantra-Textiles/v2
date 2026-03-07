"use server"

import { sdk } from "@lib/config"
import { getAuthHeaders, getCacheOptions, getCartId } from "./cookies"

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
  customer_id?: string
  excalidraw?: any // Excalidraw mood board data for designers
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
  moodboard?: any // Excalidraw-format mood board data stored on design.moodboard
  inventory_ids?: string[]
  partner_id?: string
  color_palette?: Array<{ name: string; code: string }>
  custom_sizes?: Record<string, Record<string, number>>
  tags?: string[]
}

// Request body for updating a design (all fields optional)
export type UpdateDesignInput = Partial<Omit<CreateDesignInput, "name">> & {
  name?: string
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

/**
 * Updates an existing design owned by the authenticated customer
 */
export const updateDesign = async (
  designId: string,
  input: UpdateDesignInput
): Promise<{ design: Design }> => {
  const headers = {
    ...(await getAuthHeaders()),
    "Content-Type": "application/json",
  }

  try {
    const data = await sdk.client.fetch<{ design: Design }>(
      `/store/custom/designs/${designId}`,
      {
        method: "PUT",
        body: input,
        headers,
      }
    )
    return data
  } catch (error) {
    console.error("Error updating design:", error)
    throw error
  }
}

// Cost estimation types
export type CostEstimate = {
  costs: {
    material_cost: number
    production_cost: number
    total_estimated: number
    confidence: "exact" | "estimated" | "guesstimate"
  }
  breakdown: {
    materials: Array<{
      inventory_item_id: string
      name: string
      cost: number
      quantity: number
      cost_source: string
    }>
    production_percent: number
  }
  similar_designs?: Array<{
    id: string
    name: string
    estimated_cost: number
  }>
}

export type CheckoutDesignResponse = {
  line_item_id: string
  price: number
  cost_estimate: CostEstimate["costs"] & {
    breakdown: CostEstimate["breakdown"]
  }
}

/**
 * Gets cost estimate for a design
 */
export const getDesignEstimate = async (
  designId: string
): Promise<CostEstimate> => {
  const headers = {
    ...(await getAuthHeaders()),
  }

  try {
    const data = await sdk.client.fetch<CostEstimate>(
      `/store/custom/designs/${designId}/estimate`,
      {
        method: "GET",
        headers,
      }
    )

    return data
  } catch (error) {
    console.error("Error getting design estimate:", error)
    throw error
  }
}

/**
 * Checks out a design - adds a custom line item to the cart (no product created yet).
 * Admin approval creates the real product/variant.
 */
export const checkoutDesign = async (
  designId: string,
  options?: { currency_code?: string; countryCode?: string }
): Promise<CheckoutDesignResponse> => {
  const headers = {
    ...(await getAuthHeaders()),
    "Content-Type": "application/json",
  }

  const cartId = await getCartId()

  try {
    const data = await sdk.client.fetch<CheckoutDesignResponse>(
      `/store/custom/designs/${designId}/checkout`,
      {
        method: "POST",
        body: { ...(options || {}), cart_id: cartId },
        headers,
      }
    )

    return data
  } catch (error) {
    console.error("Error checking out design:", error)
    throw error
  }
}
