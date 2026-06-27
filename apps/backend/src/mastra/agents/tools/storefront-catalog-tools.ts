/**
 * Catalog browsing tools for the storefront chat agent.
 *
 * Companions to `search_products` (storefront-search-products.ts) that let the
 * concierge answer the rest of the shopping flow:
 *   - get_categories       — "what do you sell / what categories are there?"
 *   - get_category_products — "show me everything in <category>"
 *   - get_product_details   — "tell me more about <product>"
 *
 * Same design as the search tool: in-process via the MedusaContainer (no HTTP
 * hop), product results returned in the AgentProductHit shape so the chat UI
 * renders the same product cards, with attribution so partner products link out.
 */
import type { MedusaContainer } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { tool } from "ai"
import { z } from "zod"
import { attachStorefrontAttribution } from "../../../api/store/ai/search/storefront-attribution"
import type { AgentProductHit } from "./storefront-search-products"

const PRODUCT_CARD_FIELDS = [
  "id",
  "handle",
  "title",
  "subtitle",
  "thumbnail",
  "status",
  "sales_channels.id",
  "sales_channels.name",
]

const toHits = async (
  rows: any[],
  container: MedusaContainer
): Promise<AgentProductHit[]> => {
  const attributed = await attachStorefrontAttribution(rows as any, container as any)
  return attributed.map((p: any) => ({
    id: p.id,
    handle: p.handle,
    title: p.title,
    subtitle: p.subtitle ?? null,
    thumbnail: p.thumbnail ?? null,
    storefront: p.storefront,
  }))
}

// ── get_categories ─────────────────────────────────────────────────────

export type AgentCategory = {
  name: string
  handle: string
  description: string | null
}

export const runGetCategories = async (
  container: MedusaContainer,
  limit = 50
): Promise<{ categories: AgentCategory[]; count: number }> => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product_category",
    fields: ["id", "name", "handle", "description", "rank"],
    filters: { is_active: true, is_internal: false } as any,
    pagination: { take: limit, skip: 0 },
  })
  const categories = (data ?? []).map((c: any) => ({
    name: c.name,
    handle: c.handle,
    description: c.description ?? null,
  }))
  return { categories, count: categories.length }
}

export const createGetCategoriesTool = (container: MedusaContainer) =>
  tool({
    description:
      "List the storefront's product categories (name + handle). Use when the shopper asks what you sell, what categories/collections exist, or how the catalogue is organised. Returns categories, not products — summarise them in prose.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        return await runGetCategories(container)
      } catch (e: any) {
        return { categories: [], count: 0, error: e?.message ?? "failed" }
      }
    },
  })

// ── get_category_products ──────────────────────────────────────────────

const CategoryProductsArgs = z.object({
  category: z
    .string()
    .min(1)
    .max(120)
    .describe("Category name or handle, e.g. 'sarees' or 'Hand-woven'."),
  limit: z.number().int().min(1).max(12).optional().default(6),
})
type CategoryProductsArgs = z.infer<typeof CategoryProductsArgs>

export const runGetCategoryProducts = async (
  args: CategoryProductsArgs,
  container: MedusaContainer
): Promise<{ products: AgentProductHit[]; count: number; category?: string; error?: string }> => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const limit = args.limit ?? 6

  // Resolve the category by handle, then by name — pull its product ids via the
  // category->products relation (avoids a product-side sales_channel filter,
  // which the ORM doesn't model directly).
  const byHandle = await query.graph({
    entity: "product_category",
    fields: ["id", "name", "handle", "products.id"],
    filters: { handle: args.category, is_active: true } as any,
  })
  let category = (byHandle.data ?? [])[0]
  if (!category) {
    const byName = await query.graph({
      entity: "product_category",
      fields: ["id", "name", "handle", "products.id"],
      filters: { name: args.category, is_active: true } as any,
    })
    category = (byName.data ?? [])[0]
  }
  if (!category) {
    return { products: [], count: 0, error: `No category matching "${args.category}".` }
  }

  const productIds: string[] = (category.products ?? [])
    .map((p: any) => p?.id)
    .filter(Boolean)
  if (!productIds.length) {
    return { products: [], count: 0, category: category.name }
  }

  const { data } = await query.graph({
    entity: "product",
    fields: PRODUCT_CARD_FIELDS,
    filters: { id: productIds, status: "published" } as any,
    pagination: { take: limit, skip: 0 },
  })
  const products = await toHits(data ?? [], container)
  return { products, count: products.length, category: category.name }
}

export const createGetCategoryProductsTool = (container: MedusaContainer) =>
  tool({
    description:
      "List published products in a specific category by name or handle. Use when the shopper wants to browse a category ('show me your sarees'). The UI renders the product cards below your text, so just write a short prose intro.",
    inputSchema: CategoryProductsArgs,
    execute: async (args) => {
      try {
        return await runGetCategoryProducts(args as CategoryProductsArgs, container)
      } catch (e: any) {
        return { products: [], count: 0, error: e?.message ?? "failed" }
      }
    },
  })

// ── get_product_details ────────────────────────────────────────────────

const ProductDetailsArgs = z.object({
  handle: z
    .string()
    .min(1)
    .max(160)
    .describe("Product handle (slug), e.g. 'indigo-handwoven-kurta'."),
})
type ProductDetailsArgs = z.infer<typeof ProductDetailsArgs>

export type AgentProductDetails = {
  handle: string
  title: string
  subtitle: string | null
  description: string | null
  material: string | null
  options: { title: string; values: string[] }[]
  variants: string[]
}

export const runGetProductDetails = async (
  args: ProductDetailsArgs,
  container: MedusaContainer
): Promise<{ product?: AgentProductDetails; products: AgentProductHit[]; error?: string }> => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product",
    fields: [
      ...PRODUCT_CARD_FIELDS,
      "description",
      "material",
      "options.title",
      "options.values.value",
      "variants.title",
    ],
    filters: { handle: args.handle, status: "published" } as any,
  })
  const row = (data ?? [])[0]
  if (!row) {
    return { products: [], error: `No published product with handle "${args.handle}".` }
  }

  const product: AgentProductDetails = {
    handle: row.handle,
    title: row.title,
    subtitle: row.subtitle ?? null,
    description: row.description ?? null,
    material: row.material ?? null,
    options: (row.options ?? []).map((o: any) => ({
      title: o.title,
      values: (o.values ?? []).map((v: any) => v.value).filter(Boolean),
    })),
    variants: (row.variants ?? []).map((v: any) => v.title).filter(Boolean),
  }
  const products = await toHits([row], container)
  return { product, products }
}

export const createGetProductDetailsTool = (container: MedusaContainer) =>
  tool({
    description:
      "Get details for one product by its handle: description, material, available options (sizes/colors) and variants. Use when the shopper asks about a specific item. Don't quote a price unless a tool returned one.",
    inputSchema: ProductDetailsArgs,
    execute: async (args) => {
      try {
        return await runGetProductDetails(args as ProductDetailsArgs, container)
      } catch (e: any) {
        return { products: [], error: e?.message ?? "failed" }
      }
    },
  })
