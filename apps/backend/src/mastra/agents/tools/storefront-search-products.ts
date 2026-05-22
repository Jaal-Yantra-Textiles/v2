/**
 * search_products — AI SDK tool for the storefront chat agent.
 *
 * Wraps the same vector + lexical pipeline as `GET /store/ai/search`
 * (productCatalog.searchProducts + Medusa graph hydration) but exposes
 * a trimmed, agent-friendly shape: just enough fields to render a card
 * client-side AND for the model to talk about the result in prose.
 *
 * Why a thin wrapper rather than calling `/store/ai/search` over HTTP:
 *   - We already have the MedusaContainer; an in-process call avoids
 *     the extra hop, keeps tracing in one place, and lets us pass
 *     pre-extracted constraints (color, material) straight through
 *     without re-running the LLM extraction step.
 *   - The chat surface and the inline `/store` search will likely
 *     diverge in fields the UI wants (e.g. price ranges, why-it-matched
 *     hints); coupling them via HTTP would slow that down.
 */
import type { MedusaContainer } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { tool } from "ai"
import { z } from "zod"
import { searchProducts } from "../../rag/productCatalog"
import {
  attachStorefrontAttribution,
  type StorefrontAttribution,
} from "../../../api/store/ai/search/storefront-attribution"

/**
 * Trimmed product shape returned to the agent. Mirrors what the modal
 * needs to render a small product card — anything more is bloat the
 * model has to think through.
 */
export type AgentProductHit = {
  id: string
  handle: string
  title: string
  subtitle: string | null
  thumbnail: string | null
  storefront: StorefrontAttribution
}

const PRODUCT_FIELDS = [
  "id",
  "handle",
  "title",
  "subtitle",
  "thumbnail",
  "status",
  "sales_channels.id",
  "sales_channels.name",
]

const SearchArgsSchema = z.object({
  query: z
    .string()
    .min(2)
    .max(200)
    .describe(
      "Natural-language description of what the shopper wants (e.g. 'soft cotton handwoven kurta in indigo')"
    ),
  color: z
    .string()
    .min(1)
    .max(30)
    .optional()
    .describe("Color filter if the shopper named one"),
  material: z
    .string()
    .min(1)
    .max(30)
    .optional()
    .describe("Fabric / material filter if mentioned (cotton, silk, linen, …)"),
  max_price: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Price ceiling in major currency units. Omit if unspecified."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(12)
    .optional()
    .default(6)
    .describe("How many results to return. 4-6 is a good default for chat."),
})

type SearchArgs = z.infer<typeof SearchArgsSchema>

const buildEnrichedQuery = (args: SearchArgs): string => {
  const extras: string[] = []
  if (args.color) extras.push(args.color)
  if (args.material) extras.push(args.material)
  return extras.length ? `${args.query}. Keywords: ${extras.join(", ")}` : args.query
}

export const runStorefrontSearch = async (
  args: SearchArgs,
  container: MedusaContainer
): Promise<{ products: AgentProductHit[]; mode: "vector" | "lexical"; count: number }> => {
  const queryService = container.resolve(ContainerRegistrationKeys.QUERY)
  const limit = args.limit ?? 6
  const enriched = buildEnrichedQuery(args)

  let productIds: string[] = []
  let mode: "vector" | "lexical" = "vector"
  try {
    const hits = await searchProducts(enriched, Math.max(limit * 3, 18), container as any)
    productIds = hits.map((h) => h.product_id).filter(Boolean)
  } catch {
    productIds = []
  }

  let products: any[] = []
  if (productIds.length) {
    const { data } = await queryService.graph({
      entity: "product",
      fields: PRODUCT_FIELDS,
      filters: { id: productIds, status: "published" } as any,
    })
    const byId = new Map((data ?? []).map((p: any) => [p.id, p]))
    products = productIds.map((id) => byId.get(id)).filter(Boolean)
  }

  if (!products.length) {
    mode = "lexical"
    const terms: string[] = []
    if (args.color) terms.push(args.color)
    if (args.material) terms.push(args.material)
    const q = terms.length ? `${args.query} ${terms.join(" ")}` : args.query
    const { data } = await queryService.graph({
      entity: "product",
      fields: PRODUCT_FIELDS,
      filters: { status: "published", q } as any,
      pagination: { take: Math.max(limit * 3, 18), skip: 0 },
    })
    products = data ?? []
  }

  const capped = products.slice(0, limit)
  const attributed = await attachStorefrontAttribution(capped as any, container as any)

  const trimmed: AgentProductHit[] = attributed.map((p: any) => ({
    id: p.id,
    handle: p.handle,
    title: p.title,
    subtitle: p.subtitle ?? null,
    thumbnail: p.thumbnail ?? null,
    storefront: p.storefront,
  }))

  return { products: trimmed, mode, count: trimmed.length }
}

/**
 * Build the AI SDK tool bound to a specific request's container so the
 * agent can call it without re-resolving services on every invocation.
 * Returned per-request — never cache across requests.
 */
export const createSearchProductsTool = (container: MedusaContainer) =>
  tool({
    description:
      "Search the Cici Label / JYT product catalogue using natural-language understanding. Use this whenever the shopper is asking about products, asking what's available, or describing what they want to buy. Don't quote prices or stock unless this tool returns them.",
    inputSchema: SearchArgsSchema,
    execute: async (args) => {
      try {
        const result = await runStorefrontSearch(args as SearchArgs, container)
        return result
      } catch (e: any) {
        return {
          products: [],
          mode: "vector" as const,
          count: 0,
          error: e?.message ?? "search failed",
        }
      }
    },
  })
