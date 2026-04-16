import { MetadataRoute } from "next"
import { listCollections } from "@lib/data/collections"
import { listCategories } from "@lib/data/categories"
import { listRegions } from "@lib/data/regions"
import { getBaseURL } from "@lib/util/env"

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = getBaseURL()

  const regions = await listRegions().catch(() => [])
  const countryCodes = regions
    ?.flatMap((r) => r.countries?.map((c) => c.iso_2))
    .filter(Boolean) as string[]

  if (!countryCodes.length) {
    countryCodes.push("in")
  }

  const entries: MetadataRoute.Sitemap = []

  // Static pages per country
  for (const cc of countryCodes) {
    entries.push(
      { url: `${baseUrl}/${cc}`, lastModified: new Date(), changeFrequency: "daily", priority: 1.0 },
      { url: `${baseUrl}/${cc}/store`, lastModified: new Date(), changeFrequency: "daily", priority: 0.8 },
    )
  }

  // Collections
  try {
    const { collections } = await listCollections()
    for (const col of collections || []) {
      for (const cc of countryCodes) {
        entries.push({
          url: `${baseUrl}/${cc}/collections/${col.handle}`,
          lastModified: col.updated_at ? new Date(col.updated_at) : new Date(),
          changeFrequency: "weekly",
          priority: 0.7,
        })
      }
    }
  } catch { /* skip if unavailable */ }

  // Categories
  try {
    const categories = await listCategories()
    for (const cat of categories || []) {
      for (const cc of countryCodes) {
        entries.push({
          url: `${baseUrl}/${cc}/categories/${cat.handle}`,
          lastModified: new Date(),
          changeFrequency: "weekly",
          priority: 0.7,
        })
      }
    }
  } catch { /* skip if unavailable */ }

  // Products — fetch page by page
  try {
    const { sdk } = await import("@lib/config")
    const regionId = regions?.[0]?.id
    if (regionId) {
      let offset = 0
      const limit = 100
      let hasMore = true

      while (hasMore) {
        const { products, count } = await sdk.client
          .fetch<{ products: any[]; count: number }>(`/store/products`, {
            query: { limit, offset, region_id: regionId, fields: "handle,updated_at" },
            cache: "force-cache",
          })

        for (const product of products || []) {
          for (const cc of countryCodes) {
            entries.push({
              url: `${baseUrl}/${cc}/products/${product.handle}`,
              lastModified: product.updated_at ? new Date(product.updated_at) : new Date(),
              changeFrequency: "weekly",
              priority: 0.9,
            })
          }
        }

        offset += limit
        hasMore = offset < count
      }
    }
  } catch { /* skip if unavailable */ }

  return entries
}
