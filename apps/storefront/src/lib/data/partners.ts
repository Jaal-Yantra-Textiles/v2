"use server"

import { sdk } from "@lib/config"
import { getAuthHeaders, getCacheOptions } from "./cookies"

export type Partner = {
  id: string
  name?: string
  company_name?: string
  handle?: string
  logo_url?: string
  description?: string
  type?: string
  specializations?: string[]
  metadata?: Record<string, any>
}

export type ListPartnersResponse = {
  partners: Partner[]
  count: number
  offset: number
  limit: number
}

/**
 * Fetches partners available for production
 * These are verified partners that customers can select for their custom designs
 */
export const listPartners = async ({
  limit = 20,
  offset = 0,
  q,
}: {
  limit?: number
  offset?: number
  q?: string
} = {}): Promise<ListPartnersResponse> => {
  const headers = {
    ...(await getAuthHeaders()),
  }

  const next = {
    ...(await getCacheOptions("partners")),
  }

  try {
    const data = await sdk.client.fetch<ListPartnersResponse>(
      `/store/custom/partners`,
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
      partners: data.partners || [],
      count: data.count || 0,
      offset: data.offset || offset,
      limit: data.limit || limit,
    }
  } catch (error) {
    console.error("Error fetching partners:", error)
    return {
      partners: [],
      count: 0,
      offset,
      limit,
    }
  }
}

/**
 * Fetches a single partner by ID
 */
export const getPartner = async (id: string): Promise<Partner | null> => {
  const { partners } = await listPartners({ limit: 100 })
  return partners.find((p) => p.id === id) || null
}
