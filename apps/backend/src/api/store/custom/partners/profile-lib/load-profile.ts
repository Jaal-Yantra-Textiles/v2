import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import partnerProductLink from "../../../../../links/partner-product"
import productDesignLink from "../../../../../links/product-design-link"
import { MEDIA_MODULE } from "../../../../../modules/media"
import { PARTNER_CAPABILITY_MODULE } from "../../../../../modules/partner_capability"
import { PARTNER_ONBOARDING_PROFILE_MODULE } from "../../../../../modules/partner-onboarding-profile"
import { WEBSITE_MODULE } from "../../../../../modules/website"
import {
  countRoles,
  publicCapabilities,
  summarizeEnergy,
  summarizeRuns,
} from "./build-profile"
import type { EnergySummary, PublicCapability } from "./build-profile"

export type PublicPartnerProfile = {
  id: string
  name: string
  handle: string
  logo: string | null
  country_code: string | null
  tagline: string | null
  about: string | null
  cover_image: string | null
  team_size: number | null
  roles: Array<{ role: string; count: number }>
  capabilities: PublicCapability[]
  making: {
    pieces_made: number
    samples_made: number
    pieces_last_90_days: number
    making_since: string | null
  }
  /** Measured only; null when nothing was measured. */
  energy: EnergySummary | null
  products: Array<{ id: string; title: string; handle: string; thumbnail: string | null }>
}

const MAX_SAMPLES = 24
const MAX_PRODUCTS = 8

const text = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : ""
  return s || null
}

/** Each side read is best-effort: one missing module must not 500 the page. */
const soft = async <T>(logger: any, what: string, fn: () => Promise<T>, fallback: T) => {
  try {
    return await fn()
  } catch (e: any) {
    logger?.warn?.(`[partner-profile] ${what} failed: ${e?.message ?? e}`)
    return fallback
  }
}

/**
 * Load a partner's public page by handle. Null unless the partner switched the
 * page on AND is active — an inactive partner's page disappears with them.
 * `salesChannelIds` scopes the products to the shop asking.
 */
export async function loadPartnerProfile(
  scope: any,
  handle: string,
  salesChannelIds: string[]
): Promise<PublicPartnerProfile | null> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const logger = scope.resolve(ContainerRegistrationKeys.LOGGER)

  const { data: partners } = await query.graph({
    entity: "partners",
    filters: { handle, is_public: true, status: "active" },
    fields: [
      "id",
      "name",
      "handle",
      "logo",
      "country_code",
      "website_id",
      "metadata",
      "people.id",
    ],
  })
  const partner: any = partners?.[0]
  if (!partner) return null

  const [people, runs, samples, onboarding, website] = await Promise.all([
    // 🔴 The field is `person_types`, although links/person-person-types.ts
    // declares `field: 'person_type'` — the singular name silently returns no
    // roles at all.
    soft(logger, "people", async () => {
      const ids = (partner.people ?? []).map((p: any) => p?.id).filter(Boolean)
      if (!ids.length) return []
      const { data } = await query.graph({
        entity: "person",
        filters: { id: ids },
        fields: ["id", "person_types.name"],
      })
      return (data ?? []) as any[]
    }, [] as any[]),
    soft(logger, "runs", async () => {
      const { data } = await query.graph({
        entity: "production_runs",
        filters: { partner_id: partner.id },
        fields: [
          "id",
          "partner_id",
          "parent_run_id",
          "status",
          "run_type",
          "quantity",
          "produced_quantity",
          "completed_at",
          "design_id",
        ],
      })
      return (data ?? []) as any[]
    }, [] as any[]),
    soft(logger, "capabilities", async () => {
      const svc: any = scope.resolve(PARTNER_CAPABILITY_MODULE)
      return (await svc.listPartnerCapabilitySamples(
        { partner_id: partner.id },
        { take: MAX_SAMPLES, order: { captured_at: "DESC" } }
      )) as any[]
    }, [] as any[]),
    soft(logger, "onboarding", async () => {
      const svc: any = scope.resolve(PARTNER_ONBOARDING_PROFILE_MODULE)
      const [row] = await svc.listPartnerOnboardingProfiles({ partner_id: partner.id }, { take: 1 })
      return row ?? null
    }, null as any),
    soft(logger, "website", async () => {
      if (!partner.website_id) return null
      const svc: any = scope.resolve(WEBSITE_MODULE)
      const [row] = await svc.listWebsites({ id: partner.website_id }, { take: 1 })
      return row ?? null
    }, null as any),
  ])

  const runSummary = summarizeRuns(runs, partner.id)

  const [logs, media, products] = await Promise.all([
    soft(logger, "consumption", async () => {
      if (!runSummary.run_ids.length) return []
      const { data } = await query.graph({
        entity: "consumption_log",
        filters: { production_run_id: runSummary.run_ids },
        fields: ["production_run_id", "consumption_type", "quantity", "quantity_basis", "metadata"],
      })
      return (data ?? []) as any[]
    }, [] as any[]),
    soft(logger, "media", async () => {
      const ids = Array.from(new Set(samples.flatMap((s: any) => s?.media_file_ids ?? [])))
      if (!ids.length) return []
      const svc: any = scope.resolve(MEDIA_MODULE)
      return (await svc.listMediaFiles({ id: ids })) as any[]
    }, [] as any[]),
    soft(logger, "products", () =>
      loadPartnerProducts(query, partner.id, runSummary.design_ids, salesChannelIds),
      [] as PublicPartnerProfile["products"]
    ),
  ])

  const theme: any = website?.theme ?? {}
  return {
    id: partner.id,
    name: String(partner.name ?? "").trim(),
    handle: partner.handle,
    logo: text(partner.logo),
    country_code: text(partner.country_code),
    tagline: text(theme?.branding?.tagline),
    // What the partner wrote about their business at sign-up, else their
    // website's own description. NOT metadata.story: those are quotes about
    // the platform, written for our marketing.
    about: text(partner.metadata?.business_description) ?? text(website?.description),
    cover_image: text(theme?.hero?.background_image_url),
    team_size: Number(onboarding?.team_size) > 0 ? Number(onboarding.team_size) : null,
    roles: countRoles(people),
    capabilities: publicCapabilities(samples, media),
    making: {
      pieces_made: runSummary.pieces_made,
      samples_made: runSummary.samples_made,
      pieces_last_90_days: runSummary.pieces_last_90_days,
      making_since: runSummary.making_since,
    },
    energy: summarizeEnergy(logs, runs),
    products,
  }
}

/**
 * Their products on sale in THIS shop: the ones they own, then the ones made
 * from designs they produced. Published only, and only in the asking shop's
 * sales channels — never another partner's catalogue.
 */
async function loadPartnerProducts(
  query: any,
  partnerId: string,
  designIds: string[],
  salesChannelIds: string[]
): Promise<PublicPartnerProfile["products"]> {
  if (!salesChannelIds.length) return []

  const [{ data: owned }, { data: fromDesigns }] = await Promise.all([
    query.graph({
      entity: partnerProductLink.entryPoint,
      filters: { partner_id: partnerId },
      fields: ["product_id"],
    }),
    designIds.length
      ? query.graph({
          entity: productDesignLink.entryPoint,
          filters: { design_id: designIds },
          fields: ["product_id"],
        })
      : Promise.resolve({ data: [] }),
  ])
  const ids = Array.from(
    new Set([...(owned ?? []), ...(fromDesigns ?? [])].map((l: any) => l?.product_id).filter(Boolean))
  )
  if (!ids.length) return []

  const { data: inShop } = await query.graph({
    entity: "product_sales_channel",
    filters: { product_id: ids, sales_channel_id: salesChannelIds },
    fields: ["product_id"],
  })
  const shopIds = Array.from(new Set((inShop ?? []).map((l: any) => l.product_id)))
  if (!shopIds.length) return []

  const { data: products } = await query.graph({
    entity: "product",
    filters: { id: shopIds, status: "published" },
    fields: ["id", "title", "handle", "thumbnail"],
    pagination: { skip: 0, take: MAX_PRODUCTS },
  })
  return (products ?? []).map((p: any) => ({
    id: p.id,
    title: p.title,
    handle: p.handle,
    thumbnail: p.thumbnail ?? null,
  }))
}
