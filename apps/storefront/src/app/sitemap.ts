import { MetadataRoute } from "next"
import { listCollections } from "@lib/data/collections"
import { listCategories } from "@lib/data/categories"
import { listRegions } from "@lib/data/regions"
import { getBaseURL } from "@lib/util/env"
import { countryToLocale } from "@lib/util/seo"

type SitemapEntry = MetadataRoute.Sitemap[number]

// Hard cap so a slow/hung backend can't stall the entire build.
// Next 15 builds fail the sitemap route after ~60s; we bail earlier.
const PRODUCT_FETCH_TIMEOUT_MS = 45_000
const PRODUCT_PAGE_LIMIT = 100

const withTimeout = <T,>(p: Promise<T>, ms: number, label: string): Promise<T> =>
  Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ])

/**
 * Build a single sitemap entry with per-country `alternates.languages`.
 * Using a single URL (the "default" country) with alternates is what
 * Google recommends for localized pages — it avoids duplicate-content
 * confusion and reduces sitemap bloat vs one entry per country.
 */
const buildEntry = ({
  baseUrl,
  countryCodes,
  defaultCountry,
  path,
  lastModified,
  changeFrequency,
  priority,
}: {
  baseUrl: string
  countryCodes: string[]
  defaultCountry: string
  path: string
  lastModified?: Date
  changeFrequency?: SitemapEntry["changeFrequency"]
  priority?: number
}): SitemapEntry => {
  const cleanPath = path.replace(/^\/+/, "")
  const suffix = cleanPath ? `/${cleanPath}` : ""

  const languages: Record<string, string> = {}
  for (const cc of countryCodes) {
    languages[countryToLocale(cc)] = `${baseUrl}/${cc}${suffix}`
  }
  languages["x-default"] = `${baseUrl}/${defaultCountry}${suffix}`

  return {
    url: `${baseUrl}/${defaultCountry}${suffix}`,
    lastModified: lastModified ?? new Date(),
    changeFrequency,
    priority,
    alternates: { languages },
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = getBaseURL()

  const regions = await listRegions().catch(() => [])
  const countryCodes = (regions ?? [])
    .flatMap((r) => r.countries?.map((c) => c.iso_2) ?? [])
    .filter((c): c is string => Boolean(c))

  if (!countryCodes.length) {
    countryCodes.push("in")
  }

  // "in" is our primary market; fall back to the first available code.
  const defaultCountry = countryCodes.includes("in") ? "in" : countryCodes[0]

  const entries: MetadataRoute.Sitemap = []

  // Static pages
  entries.push(
    buildEntry({
      baseUrl,
      countryCodes,
      defaultCountry,
      path: "",
      changeFrequency: "daily",
      priority: 1.0,
    }),
    buildEntry({
      baseUrl,
      countryCodes,
      defaultCountry,
      path: "store",
      changeFrequency: "daily",
      priority: 0.8,
    })
  )

  // Collections
  try {
    const { collections } = await listCollections()
    for (const col of collections || []) {
      entries.push(
        buildEntry({
          baseUrl,
          countryCodes,
          defaultCountry,
          path: `collections/${col.handle}`,
          lastModified: col.updated_at ? new Date(col.updated_at) : undefined,
          changeFrequency: "weekly",
          priority: 0.7,
        })
      )
    }
  } catch {
    /* skip if unavailable */
  }

  // Categories
  try {
    const categories = await listCategories()
    for (const cat of categories || []) {
      entries.push(
        buildEntry({
          baseUrl,
          countryCodes,
          defaultCountry,
          path: `categories/${cat.handle}`,
          changeFrequency: "weekly",
          priority: 0.7,
        })
      )
    }
  } catch {
    /* skip if unavailable */
  }

  // Products — paginated, with a global timeout so a stuck backend
  // can't take down the whole build.
  try {
    const { sdk } = await import("@lib/config")
    const regionId = regions?.[0]?.id
    if (regionId) {
      const fetchAllProducts = async () => {
        let offset = 0
        let hasMore = true

        while (hasMore) {
          const { products, count } = await sdk.client.fetch<{
            products: any[]
            count: number
          }>(`/store/products`, {
            query: {
              limit: PRODUCT_PAGE_LIMIT,
              offset,
              region_id: regionId,
              fields: "handle,updated_at",
            },
            cache: "force-cache",
          })

          for (const product of products || []) {
            entries.push(
              buildEntry({
                baseUrl,
                countryCodes,
                defaultCountry,
                path: `products/${product.handle}`,
                lastModified: product.updated_at
                  ? new Date(product.updated_at)
                  : undefined,
                changeFrequency: "weekly",
                priority: 0.9,
              })
            )
          }

          offset += PRODUCT_PAGE_LIMIT
          hasMore = offset < count
        }
      }

      await withTimeout(
        fetchAllProducts(),
        PRODUCT_FETCH_TIMEOUT_MS,
        "sitemap product fetch"
      )
    }
  } catch (err) {
    // Don't fail the build — a partial sitemap is better than none.
    console.warn("[sitemap] product fetch skipped:", (err as Error).message)
  }

  return entries
}
