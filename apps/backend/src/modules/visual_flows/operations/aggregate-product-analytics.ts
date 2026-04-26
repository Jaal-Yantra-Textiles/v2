import { z } from "@medusajs/framework/zod"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { IProductModuleService } from "@medusajs/types"
import type { OperationContext, OperationDefinition, OperationResult } from "./types"
import { ANALYTICS_MODULE } from "../../analytics"
import type AnalyticsService from "../../analytics/service"

type DailyBreakdown = {
  views: number
  by_source: Record<string, number>
  by_country: Record<string, number>
}

function toYMD(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

function inc(map: Record<string, number>, key: string) {
  map[key] = (map[key] || 0) + 1
}

export const aggregateProductAnalyticsOperation: OperationDefinition = {
  type: "aggregate_product_analytics",
  name: "Aggregate Product Analytics",
  description: "Aggregate /products pageviews and write daily rollups to product.metadata",
  icon: "chart-bar",
  category: "data",

  optionsSchema: z.object({
    days_back: z
      .number()
      .int()
      .min(1)
      .max(30)
      .optional()
      .default(1)
      .describe("How many days back to aggregate (1 = yesterday)") ,
    pathname_prefix: z
      .string()
      .optional()
      .default("/products/")
      .describe("Only include events whose pathname starts with this prefix"),
    metadata_key: z
      .string()
      .optional()
      .default("analytics")
      .describe("Root key under product.metadata where analytics rollups are stored"),
    website_id: z
      .string()
      .optional()
      .describe("Optional website_id filter (if omitted aggregates across all websites)"),
  }),

  defaultOptions: {
    days_back: 1,
    pathname_prefix: "/products/",
    metadata_key: "analytics",
  },

  execute: async (options: any, context: OperationContext): Promise<OperationResult> => {
    const logger = context.container.resolve(ContainerRegistrationKeys.LOGGER)
    const analyticsService = context.container.resolve(ANALYTICS_MODULE) as unknown as AnalyticsService
    const productService = context.container.resolve(Modules.PRODUCT) as IProductModuleService

    const daysBack = Number(options?.days_back ?? 1)
    const prefix = String(options?.pathname_prefix ?? "/products/")
    const metadataKey = String(options?.metadata_key ?? "analytics")
    const websiteId = options?.website_id ? String(options.website_id) : undefined

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const start = new Date(today)
    start.setDate(start.getDate() - daysBack)

    const end = new Date(start)
    end.setDate(end.getDate() + 1)

    const dayKey = toYMD(start)

    const [events] = await analyticsService.listAndCountAnalyticsEvents(
      {
        timestamp: {
          $gte: start,
          $lt: end,
        },
      } as any,
      {
        select: [
          "website_id",
          "event_type",
          "pathname",
          "referrer_source",
          "country",
        ],
      } as any
    )

    const productEvents = (events || []).filter((e: any) => {
      if (e?.event_type !== "pageview") {
        return false
      }
      if (websiteId && e?.website_id !== websiteId) {
        return false
      }
      const pathname = String(e?.pathname || "")
      return pathname.startsWith(prefix)
    })

    const breakdownByHandle = new Map<string, DailyBreakdown>()

    for (const e of productEvents) {
      const pathname = String(e?.pathname || "")
      const handle = pathname.split("/").filter(Boolean)[1]

      if (!handle) {
        continue
      }

      const source = (e?.referrer_source ? String(e.referrer_source) : "direct")
      const country = (e?.country ? String(e.country) : "unknown")

      const current = breakdownByHandle.get(handle) || {
        views: 0,
        by_source: {},
        by_country: {},
      }

      current.views += 1
      inc(current.by_source, source)
      inc(current.by_country, country)

      breakdownByHandle.set(handle, current)
    }

    const handles = Array.from(breakdownByHandle.keys())

    if (!handles.length) {
      return {
        success: true,
        data: {
          day: dayKey,
          prefix,
          website_id: websiteId,
          events_scanned: (events || []).length,
          product_events: productEvents.length,
          updated_products: 0,
        },
      }
    }

    const products = await productService.listProducts(
      {
        handle: handles,
      } as any,
      {
        select: ["id", "handle", "metadata"],
      } as any
    )

    const productsByHandle = new Map<string, any>()
    for (const p of products || []) {
      if (p?.handle) {
        productsByHandle.set(String(p.handle), p)
      }
    }

    let updatedCount = 0

    for (const [handle, breakdown] of breakdownByHandle.entries()) {
      const product = productsByHandle.get(handle)
      if (!product?.id) {
        continue
      }

      const existingMetadata = (product.metadata || {}) as Record<string, any>
      const existingAnalytics = (existingMetadata[metadataKey] || {}) as Record<string, any>
      const existingProductViews = (existingAnalytics.product_pageviews || {}) as Record<string, any>
      const existingDaily = (existingProductViews.daily || {}) as Record<string, any>

      const nextDaily = {
        ...existingDaily,
        [dayKey]: {
          views: breakdown.views,
          by_source: breakdown.by_source,
          by_country: breakdown.by_country,
        },
      }

      const nextMetadata = {
        ...existingMetadata,
        [metadataKey]: {
          ...existingAnalytics,
          product_pageviews: {
            ...existingProductViews,
            daily: nextDaily,
            last_updated_at: new Date().toISOString(),
            last_day: dayKey,
            website_id: websiteId,
            pathname_prefix: prefix,
          },
        },
      }

      await productService.updateProducts(product.id, {
        metadata: nextMetadata,
      } as any)

      updatedCount += 1
    }

    logger.info(
      `[aggregate_product_analytics] day=${dayKey} prefix=${prefix} website_id=${websiteId || "*"} updated=${updatedCount}`
    )

    return {
      success: true,
      data: {
        day: dayKey,
        prefix,
        website_id: websiteId,
        events_scanned: (events || []).length,
        product_events: productEvents.length,
        product_handles: handles.length,
        updated_products: updatedCount,
      },
    }
  },
}
