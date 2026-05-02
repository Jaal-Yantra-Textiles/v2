/**
 * Seed the local website (and its pages + blocks) from a remote backend's
 * public /web/website API. Useful when running locally and the storefront
 * is missing block content that lives on prod.
 *
 * The script is idempotent: it upserts the website by domain, pages by
 * (slug, website_id), and blocks by (page_id, type). To wipe and re-seed,
 * pass --reset.
 *
 * Run:
 *   npx medusa exec ./src/scripts/seed-website-from-prod.ts
 *
 * Override the source / domain:
 *   SOURCE_API=https://v3.jaalyantra.com SEED_DOMAIN=jaalyantra.com \
 *     npx medusa exec ./src/scripts/seed-website-from-prod.ts -- --reset
 *
 * Defaults:
 *   SOURCE_API   https://v3.jaalyantra.com
 *   SEED_DOMAIN  jaalyantra.com
 */

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { WEBSITE_MODULE } from "../modules/website"
import WebsiteService from "../modules/website/service"

type ProdAnalytics = {
  provider?: "in_house" | "custom" | "off"
  custom_head?: string | null
  custom_body_end?: string | null
}

type ProdWebsiteSummary = {
  id: string
  name: string
  domain: string
  theme: any
  favicon_url: string | null
  analytics?: ProdAnalytics
  pages: Array<{
    title: string
    slug: string
    content: string
    status: string
    page_type: string
    published_at: string | null
  }>
}

type ProdBlock = {
  id?: string
  name: string
  type: string
  content: any
  settings?: any
  order?: number
  status?: string
  metadata?: any
}

type ProdPageDetail = {
  title: string
  slug: string
  content: string
  status: string
  page_type: string
  published_at: string | null
  blocks?: ProdBlock[]
  meta_title?: string | null
  meta_description?: string | null
  meta_keywords?: string | null
  metadata?: any
  public_metadata?: any
}

const titleCase = (v: string | undefined): string | undefined => {
  if (!v) return undefined
  return v.charAt(0).toUpperCase() + v.slice(1).toLowerCase()
}

const PAGE_TYPES = new Set([
  "Home",
  "About",
  "Contact",
  "Blog",
  "Product",
  "Service",
  "Portfolio",
  "Landing",
  "Custom",
])
const PAGE_STATUSES = new Set(["Draft", "Published", "Archived"])
const BLOCK_TYPES = new Set([
  "Hero",
  "Header",
  "Footer",
  "MainContent",
  "ContactForm",
  "Feature",
  "Gallery",
  "Testimonial",
  "Product",
  "Section",
  "Custom",
])
const BLOCK_STATUSES = new Set(["Active", "Inactive", "Draft"])

const normalizePageType = (raw: string | undefined): string => {
  const t = titleCase(raw) || "Custom"
  return PAGE_TYPES.has(t) ? t : "Custom"
}
const normalizePageStatus = (raw: string | undefined): string => {
  const t = titleCase(raw) || "Draft"
  return PAGE_STATUSES.has(t) ? t : "Draft"
}
const normalizeBlockType = (raw: string | undefined): string => {
  // Block types are PascalCase already in prod responses.
  if (!raw) return "Custom"
  return BLOCK_TYPES.has(raw) ? raw : "Custom"
}
const normalizeBlockStatus = (raw: string | undefined): string => {
  const t = titleCase(raw) || "Active"
  return BLOCK_STATUSES.has(t) ? t : "Active"
}

const fetchJson = async <T>(url: string): Promise<T> => {
  const res = await fetch(url, { headers: { Accept: "application/json" } })
  if (!res.ok) {
    throw new Error(
      `GET ${url} failed: ${res.status} ${res.statusText} — ${await res.text().catch(() => "")}`
    )
  }
  return (await res.json()) as T
}

export default async function seedWebsiteFromProd({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE)

  const sourceApi =
    (process.env.SOURCE_API || "https://v3.jaalyantra.com").replace(/\/$/, "")
  const sourceDomain = process.env.SEED_DOMAIN || "jaalyantra.com"

  // medusa exec passes script args after `--`. We only care about --reset.
  const reset = process.argv.includes("--reset")

  logger.info(
    `Seeding website "${sourceDomain}" from ${sourceApi}/web/website/${sourceDomain} (reset=${reset})`
  )

  // 1. Fetch prod summary (website + page list).
  const summary = await fetchJson<ProdWebsiteSummary>(
    `${sourceApi}/web/website/${encodeURIComponent(sourceDomain)}`
  )
  logger.info(
    `Prod returned ${summary.pages?.length ?? 0} pages — analytics provider: ${summary.analytics?.provider ?? "n/a"}`
  )

  // 2. Upsert local website by domain.
  const [existingByDomain] = await (websiteService as any).listAndCountWebsites(
    { domain: sourceDomain },
    { take: 1 }
  )
  let website = existingByDomain?.[0]

  if (website && reset) {
    // cascade-delete pages (cascade also takes blocks).
    const [pages] = await (websiteService as any).listAndCountPages(
      { website_id: website.id },
      { take: 1000 }
    )
    if (pages?.length) {
      await (websiteService as any).deletePages(pages.map((p: any) => p.id))
      logger.info(`  reset: deleted ${pages.length} existing pages`)
    }
  }

  const websiteFields = {
    domain: summary.domain,
    name: summary.name,
    favicon_url: summary.favicon_url ?? null,
    theme: summary.theme ?? null,
    analytics_provider: summary.analytics?.provider ?? "in_house",
    analytics_custom_head: summary.analytics?.custom_head ?? null,
    analytics_custom_body_end: summary.analytics?.custom_body_end ?? null,
  }

  if (!website) {
    website = await (websiteService as any).createWebsites(websiteFields)
    logger.info(`  created website ${website.id} (${website.domain})`)
  } else {
    website = await (websiteService as any).updateWebsites({
      id: website.id,
      ...websiteFields,
    })
    logger.info(`  updated website ${website.id} (${website.domain})`)
  }

  // Make sure the primary domain row matches — the storefront lookup uses
  // the website_domain table.
  await websiteService.ensurePrimaryWebsiteDomain(website.id, summary.domain)

  // 3. Upsert each page + its blocks.
  let pagesCreated = 0
  let pagesUpdated = 0
  let blocksCreated = 0
  let blocksUpdated = 0
  const failures: Array<{ slug: string; error: string }> = []

  for (const summaryPage of summary.pages || []) {
    try {
      const detail = await fetchJson<ProdPageDetail>(
        `${sourceApi}/web/website/${encodeURIComponent(sourceDomain)}/${encodeURIComponent(summaryPage.slug)}`
      )

      const pageFields = {
        title: detail.title || summaryPage.title,
        slug: detail.slug || summaryPage.slug,
        content: detail.content ?? summaryPage.content ?? "",
        page_type: normalizePageType(detail.page_type || summaryPage.page_type),
        status: normalizePageStatus(detail.status || summaryPage.status),
        meta_title: detail.meta_title ?? null,
        meta_description: detail.meta_description ?? null,
        meta_keywords: detail.meta_keywords ?? null,
        published_at: (detail.published_at || summaryPage.published_at) ?? null,
        last_modified: new Date(),
        metadata: detail.metadata ?? null,
        public_metadata: detail.public_metadata ?? null,
        website_id: website.id,
      }

      const [existingPages] = await (websiteService as any).listAndCountPages(
        { website_id: website.id, slug: pageFields.slug },
        { take: 1 }
      )
      let page = existingPages?.[0]

      if (!page) {
        page = await (websiteService as any).createPages(pageFields)
        pagesCreated++
      } else {
        page = await (websiteService as any).updatePages({
          id: page.id,
          ...pageFields,
        })
        pagesUpdated++
      }

      // Pull existing blocks once, dedupe by type for unique-block enforcement.
      const [existingBlocks] = await (websiteService as any).listAndCountBlocks(
        { page_id: page.id },
        { take: 1000 }
      )
      const existingByType = new Map<string, any>()
      for (const b of existingBlocks || []) {
        existingByType.set(b.type, b)
      }

      for (const remoteBlock of detail.blocks || []) {
        const blockFields = {
          name: remoteBlock.name,
          type: normalizeBlockType(remoteBlock.type),
          content: remoteBlock.content ?? {},
          settings: remoteBlock.settings ?? null,
          order: typeof remoteBlock.order === "number" ? remoteBlock.order : 0,
          status: normalizeBlockStatus(remoteBlock.status),
          metadata: remoteBlock.metadata ?? null,
          page_id: page.id,
        }

        const existing = existingByType.get(blockFields.type)
        if (existing) {
          await (websiteService as any).updateBlocks({
            id: existing.id,
            ...blockFields,
          })
          blocksUpdated++
        } else {
          await (websiteService as any).createBlocks(blockFields)
          blocksCreated++
        }
      }
    } catch (e: any) {
      failures.push({ slug: summaryPage.slug, error: e.message })
      logger.error(`  ${summaryPage.slug} — ${e.message}`)
    }
  }

  logger.info(
    `Done. Pages — created ${pagesCreated}, updated ${pagesUpdated}. Blocks — created ${blocksCreated}, updated ${blocksUpdated}. Failures — ${failures.length}.`
  )
  if (failures.length) {
    for (const f of failures) {
      logger.warn(`  failed page: ${f.slug} (${f.error})`)
    }
  }
}
