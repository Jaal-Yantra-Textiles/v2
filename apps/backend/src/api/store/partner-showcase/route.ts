import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * GET /store/partner-showcase
 *
 * Returns partner stores with their categories, collections, and featured products.
 * Excludes the requesting storefront's own sales channel (so partners only see OTHER partners).
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Get the requesting storefront's sales channel IDs (to exclude)
  const mySalesChannelIds =
    (req as any).publishable_key_context?.sales_channel_ids || []

  // Fetch all partners with their stores
  const { data: partners } = await query.graph({
    entity: "partners",
    fields: [
      "id",
      "name",
      "handle",
      "logo",
      "metadata",
      "stores.id",
      "stores.name",
      "stores.default_sales_channel_id",
    ],
    filters: { status: "active" },
  })

  const showcasePartners: any[] = []

  for (const partner of (partners || []) as any[]) {
    const stores = partner.stores || []
    if (!stores.length) continue

    const store = stores[0]
    const salesChannelId = store.default_sales_channel_id
    if (!salesChannelId) continue

    // Skip the requesting storefront's own sales channel
    if (mySalesChannelIds.includes(salesChannelId)) continue

    // Get product IDs in this partner's sales channel
    const { data: links } = await query.graph({
      entity: "product_sales_channel",
      fields: ["product_id"],
      filters: { sales_channel_id: salesChannelId },
      pagination: { skip: 0, take: 100 },
    })

    const productIds = (links || []).map((l: any) => l.product_id).filter(Boolean)
    if (!productIds.length) continue

    // Fetch products with their categories and collections
    const { data: products } = await query.graph({
      entity: "product",
      fields: [
        "id",
        "title",
        "handle",
        "thumbnail",
        "status",
        "categories.id",
        "categories.name",
        "categories.handle",
        "collection.id",
        "collection.title",
        "collection.handle",
        "variants.prices.amount",
        "variants.prices.currency_code",
      ],
      filters: { id: productIds, status: "published" },
      pagination: { skip: 0, take: 8 },
    })

    if (!products?.length) continue

    // Extract unique categories and collections from this partner's products
    const categoryMap = new Map<string, any>()
    const collectionMap = new Map<string, any>()

    for (const p of products as any[]) {
      for (const cat of p.categories || []) {
        if (cat.id && !categoryMap.has(cat.id)) {
          categoryMap.set(cat.id, {
            id: cat.id,
            name: cat.name,
            handle: cat.handle,
          })
        }
      }
      if (p.collection?.id && !collectionMap.has(p.collection.id)) {
        collectionMap.set(p.collection.id, {
          id: p.collection.id,
          title: p.collection.title,
          handle: p.collection.handle,
        })
      }
    }

    // Get the storefront URL from partner metadata
    const storefrontDomain = partner.metadata?.storefront_domain
    const storefrontUrl = storefrontDomain
      ? `https://${storefrontDomain}`
      : null

    showcasePartners.push({
      id: partner.id,
      name: partner.name,
      handle: partner.handle,
      logo: partner.logo,
      storefront_url: storefrontUrl,
      store: {
        id: store.id,
        name: store.name,
      },
      categories: Array.from(categoryMap.values()),
      collections: Array.from(collectionMap.values()),
      featured_products: (products as any[]).slice(0, 4).map((p: any) => {
        const prices = (p.variants || []).flatMap((v: any) => v.prices || [])
        const lowest = prices.length
          ? prices.reduce((min: any, pr: any) =>
              pr.amount < min.amount ? pr : min
            )
          : null

        return {
          id: p.id,
          title: p.title,
          handle: p.handle,
          thumbnail: p.thumbnail,
          price: lowest
            ? { amount: lowest.amount, currency_code: lowest.currency_code }
            : null,
        }
      }),
      product_count: productIds.length,
    })
  }

  // Shuffle for variety
  for (let i = showcasePartners.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[showcasePartners[i], showcasePartners[j]] = [
      showcasePartners[j],
      showcasePartners[i],
    ]
  }

  res.json({
    partners: showcasePartners,
    count: showcasePartners.length,
  })
}
