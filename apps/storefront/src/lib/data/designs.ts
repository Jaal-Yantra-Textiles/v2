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
  moodboard?: Record<string, any> | null
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

// Extended design with relations fetched via GET /store/custom/designs/:id
export type DesignDetail = Design & {
  specifications?: Array<{
    id: string
    category?: string
    title?: string
    details?: string
    measurements?: Record<string, any>
  }>
  colors?: Array<{
    id: string
    name: string
    hex_code: string
    usage_notes?: string
    order?: number
  }>
  size_sets?: Array<{
    id: string
    size_label: string
    measurements?: Record<string, any>
  }>
  color_palette?: Array<{ name: string; code: string }>
  designer_notes?: string
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
 * Fetches a single design by ID (must be owned by the authenticated customer)
 */
export const getDesign = async (id: string): Promise<DesignDetail> => {
  const headers = {
    ...(await getAuthHeaders()),
  }

  const data = await sdk.client.fetch<{ design: DesignDetail }>(
    `/store/custom/designs/${id}`,
    {
      method: "GET",
      headers,
    }
  )
  return data.design
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
  currency_code: string
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
 * Gets cost estimate for a design.
 * Pass currency_code to get the estimate converted to the customer's local currency.
 */
export const getDesignEstimate = async (
  designId: string,
  options?: { currency_code?: string }
): Promise<CostEstimate> => {
  const headers = {
    ...(await getAuthHeaders()),
  }

  const query: Record<string, string> = {}
  if (options?.currency_code) {
    query.currency_code = options.currency_code
  }

  try {
    const data = await sdk.client.fetch<CostEstimate>(
      `/store/custom/designs/${designId}/estimate`,
      {
        method: "GET",
        headers,
        query,
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

// ──────────────────────────────────────────────────────────────────────────
// #729 — Production story (v1 task-list → v2 production-run story)
//
// Public, money-free "how this was made" data for a design: production runs
// (status/activity) + an energy/consumption summary + the people who made it
// + the raw materials used. Mirrors the backend shape in
// src/api/store/custom/designs/[id]/production-story/build-story.ts.
//
// NOTE: the storefront RENDER that replaces the v1 task-list display with this
// run-based story is a FOLLOW-UP (Playwright-gated UI). This is the data layer.
// ──────────────────────────────────────────────────────────────────────────

export type ProductionStoryActivity = {
  id: string
  activity_type: string
  kind: string
  summary: string | null
  created_at: string | null
}

export type ProductionStoryRun = {
  id: string
  status: string
  run_type: string
  quantity: number | null
  produced_quantity: number | null
  rejected_quantity: number | null
  started_at: string | null
  finished_at: string | null
  completed_at: string | null
  created_at: string | null
  activity: ProductionStoryActivity[]
}

export type EnergySummary = {
  electricity_kwh: number
  water_liters: number
  gas_cubic_meters: number
}

export type MaterialConsumed = {
  raw_material_id: string | null
  name: string | null
  unit_of_measure: string
  quantity: number
}

export type ConsumptionSummary = {
  energy: EnergySummary
  labor_hours: number
  materials_consumed: MaterialConsumed[]
  total_logs: number
}

export type StoryPerson = { id: string; name: string | null; role: string | null }
export type StoryPartner = { id: string; name: string | null }
export type StoryMaterial = {
  id: string
  name: string | null
  composition: string | null
  color: string | null
  media: unknown
  material_type: string | null
}

export type ProductionStory = {
  design_id: string
  runs: ProductionStoryRun[]
  consumption: ConsumptionSummary
  people: StoryPerson[]
  partners: StoryPartner[]
  materials: StoryMaterial[]
}

const EMPTY_PRODUCTION_STORY = (designId: string): ProductionStory => ({
  design_id: designId,
  runs: [],
  consumption: {
    energy: { electricity_kwh: 0, water_liters: 0, gas_cubic_meters: 0 },
    labor_hours: 0,
    materials_consumed: [],
    total_logs: 0,
  },
  people: [],
  partners: [],
  materials: [],
})

/**
 * Fetches the public production story for a design.
 *
 * Public/cacheable — no auth required (mirrors the public product → designs.*
 * exposure on /store/products). Returns a clean empty story on error so a
 * "how this was made" section can render defensively.
 */
export const getProductionStory = async (
  designId: string
): Promise<ProductionStory> => {
  const next = {
    ...(await getCacheOptions("designs")),
  }

  try {
    const data = await sdk.client.fetch<{ production_story: ProductionStory }>(
      `/store/custom/designs/${designId}/production-story`,
      {
        method: "GET",
        next,
        cache: "force-cache",
      }
    )
    return data.production_story ?? EMPTY_PRODUCTION_STORY(designId)
  } catch (error) {
    console.error("Error fetching production story:", error)
    return EMPTY_PRODUCTION_STORY(designId)
  }
}
