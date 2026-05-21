"use server"

import { sdk } from "@lib/config"

/**
 * Server-action wrapper around GET /store/ai/search.
 *
 * Runs on the storefront server (Node, not browser) so the SDK config's
 * MEDUSA_BACKEND_URL — which is server-runtime-only — resolves correctly.
 * The client component (`modules/home/components/ai-search.tsx`) calls
 * this from the browser; Next.js translates the call into a server
 * round-trip and the browser never talks to the Medusa backend directly.
 *
 * Why a server action and not a direct SDK fetch from the client:
 *   - Avoids needing NEXT_PUBLIC_MEDUSA_BACKEND_URL (mirrors how every
 *     other storefront page reads from the backend).
 *   - Same-origin call from the browser → no CORS pre-flight.
 *   - Backend URL stays a deploy-time secret rather than an inlined
 *     constant in every client bundle.
 */

export type AiSearchVariant = {
  id: string
  title?: string | null
  calculated_price?: {
    calculated_amount?: number | null
    currency_code?: string | null
  } | null
}

export type AiSearchStorefrontAttribution =
  | { kind: "main" }
  | {
      kind: "partner"
      url?: string
      partner_name: string
      partner_handle: string
      sales_channel_name?: string
    }

export type AiSearchProduct = {
  id: string
  handle: string
  title: string
  thumbnail?: string | null
  variants?: AiSearchVariant[]
  storefront?: AiSearchStorefrontAttribution
}

export type AiSearchResponse = {
  query: string
  mode: "vector" | "lexical"
  interpretation: {
    keywords: string[]
    color?: string
    material?: string
    min_price?: number
    max_price?: number
  }
  products: AiSearchProduct[]
  count: number
}

export const searchAiProducts = async (
  query: string,
  limit: number = 6
): Promise<AiSearchResponse | null> => {
  const trimmed = query.trim()
  if (trimmed.length < 2) return null

  try {
    // SDK-compliant GET with query params — matches the FetchArgs.query
    // contract. The backend route uses validateAndTransformQuery for
    // the same shape.
    return await sdk.client.fetch<AiSearchResponse>("/store/ai/search", {
      method: "GET",
      query: { query: trimmed, limit },
    })
  } catch (e: any) {
    // Server actions suppress thrown errors in production builds, so we
    // log here and return null. The client component renders a generic
    // "no matches" state on null/empty results.
    console.error("[searchAiProducts] failed:", e?.message ?? e)
    return null
  }
}
