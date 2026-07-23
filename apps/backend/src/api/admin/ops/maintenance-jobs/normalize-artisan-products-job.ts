import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows"

import { PARTNER_MODULE } from "../../../../modules/partner"
import { PARTNER_ONBOARDING_PROFILE_MODULE } from "../../../../modules/partner-onboarding-profile"
import partnerProductLink from "../../../../links/partner-product"
import type {
  MaintenanceChange,
  MaintenanceJob,
  MaintenanceJobResult,
} from "./registry"

/**
 * #859 Data Plumbing — normalise artisan products that were published directly
 * before the proposal gate was wired into `POST /partners/stores/:id/products`.
 *
 * A `core_channel_listing` (Airbnb-style) partner's products should enter as
 * `proposed` and be admin-approved before publish. Products created via the
 * pre-fix path are `published`, bound only to the partner's own (storefront-
 * less) sales channel, and carry NO partner→product ownership link.
 *
 * For each such product this: (1) flips status → `proposed`, (2) creates the
 * ownership link, (3) emits `partner_product.proposed` so it enters the admin
 * review queue + notifications/flows. Idempotent — a product that already has
 * an ownership link is skipped (it went through the real flow). Dry-run lists
 * what WOULD change without writing.
 */

/** Hard cap on products scanned in one call — bounds per-request blast radius. */
export const MAX_ARTISAN_NORMALIZE_SCAN = 5000

const paramsSchema = z.object({
  /** Restrict to a single partner. */
  partner_id: z.string().min(1).optional(),
  /** Max products to scan in one call. */
  limit: z
    .number()
    .int()
    .positive()
    .max(MAX_ARTISAN_NORMALIZE_SCAN)
    .optional()
    .default(1000),
})

export const normalizeArtisanProductsJob: MaintenanceJob = {
  id: "normalize-artisan-published-products",
  label: "Normalize artisan products (published → in review)",
  description:
    `Move core_channel_listing (Airbnb-style) partners' products that were published directly — before the proposal gate shipped — back to 'proposed' so they enter the admin review queue. Targets ONLY published products in an artisan partner's own sales channel that have no partner→product ownership link (i.e. created via the pre-fix path); already-linked/approved products are skipped. Apply flips status → proposed, creates the ownership link, and emits partner_product.proposed (review widget + email/flows). Dry-run lists what would change. Optionally scope to one partner_id. Scans up to 'limit' products (default 1000, max ${MAX_ARTISAN_NORMALIZE_SCAN}).`,
  params: [
    {
      name: "partner_id",
      type: "string",
      required: false,
      description: "Restrict to a single artisan partner (default: all core_channel_listing partners)",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: `Max products to scan in one call (default 1000, max ${MAX_ARTISAN_NORMALIZE_SCAN})`,
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const parsed = paramsSchema.safeParse(params)
    if (!parsed.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        parsed.error.issues.map((i) => i.message).join("; ")
      )
    }
    const { partner_id, limit } = parsed.data

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const link: any = container.resolve(ContainerRegistrationKeys.LINK)
    const eventBus: any = container.resolve(Modules.EVENT_BUS)
    const onboarding: any = container.resolve(PARTNER_ONBOARDING_PROFILE_MODULE)

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []

    // 1. Core-channel-listing partners (optionally scoped to one).
    const profileFilter: Record<string, unknown> = {
      selling_mode: "core_channel_listing",
    }
    if (partner_id) profileFilter.partner_id = partner_id
    const profiles = await onboarding.listPartnerOnboardingProfiles(profileFilter)
    const partnerIds: string[] = (profiles ?? [])
      .map((p: any) => p.partner_id)
      .filter(Boolean)

    if (!partnerIds.length) {
      return {
        job_id: normalizeArtisanProductsJob.id,
        dry_run,
        applied: false,
        summary: "No core_channel_listing partners found — nothing to normalize",
        changes,
      }
    }

    // 2. Their stores' default sales channels → owning partner.
    const { data: partners = [] } = await query.graph({
      entity: "partners",
      fields: ["id", "stores.default_sales_channel_id"],
      filters: { id: partnerIds },
    })
    const channelToPartner = new Map<string, string>()
    for (const p of partners as any[]) {
      for (const s of p.stores || []) {
        if (s?.default_sales_channel_id) {
          channelToPartner.set(s.default_sales_channel_id, p.id)
        }
      }
    }
    const channelIds = [...channelToPartner.keys()]
    if (!channelIds.length) {
      return {
        job_id: normalizeArtisanProductsJob.id,
        dry_run,
        applied: false,
        summary: "No partner sales channels found — nothing to normalize",
        changes,
      }
    }

    // 3. Products in those channels (+ status). Query from the sales_channel
    // side: `sales_channels` is a module link on product, so it can be expanded
    // in `fields` but NOT used in `filters` (MikroORM has no such property →
    // "Trying to query by not existing property Product.sales_channels"). Pivot
    // through the channel's `products_link.product` (the link graph exposes
    // products under `products_link`, NOT a direct `products` relation — see
    // list-store-products.ts / backfill-classify-products-tax-class.ts). We also
    // keep each product's originating channel so we can resolve its owner
    // directly from `channelToPartner`.
    const { data: channelsWithProducts = [] } = await query.graph({
      entity: "sales_channel",
      fields: [
        "id",
        "products_link.product.id",
        "products_link.product.title",
        "products_link.product.status",
      ],
      filters: { id: channelIds } as any,
    })

    // Flatten to unique products, tagging each with its owning partner, and cap
    // the total scanned at `limit`.
    const seen = new Set<string>()
    const products: Array<{
      id: string
      title?: string
      status?: string
      partnerId: string
    }> = []
    for (const ch of channelsWithProducts as any[]) {
      const partnerId = channelToPartner.get(ch.id)
      if (!partnerId) continue
      for (const link of ch.products_link || []) {
        const prod = link?.product
        if (!prod?.id || seen.has(prod.id)) continue
        seen.add(prod.id)
        products.push({
          id: prod.id,
          title: prod.title,
          status: prod.status,
          partnerId,
        })
        if (products.length >= limit) break
      }
      if (products.length >= limit) break
    }

    // 4. Existing ownership links → already went through the real flow.
    const { data: existingLinks = [] } = await query.graph({
      entity: partnerProductLink.entryPoint,
      fields: ["product_id", "partner_id"],
    })
    const linkedProductIds = new Set(
      (existingLinks as any[]).map((l) => l.product_id)
    )

    for (const prod of products) {
      if (prod.status !== "published") continue
      if (linkedProductIds.has(prod.id)) continue

      const partnerId = prod.partnerId
      if (!partnerId) continue

      const change: MaintenanceChange = {
        entity: "product",
        id: prod.id,
        field: "status",
        before: "published",
        after: "proposed",
      }

      if (!dry_run) {
        try {
          await updateProductsWorkflow(container).run({
            input: { products: [{ id: prod.id, status: "proposed" }] },
          })
          await link
            .create({
              [PARTNER_MODULE]: { partner_id: partnerId },
              [Modules.PRODUCT]: { product_id: prod.id },
            })
            .catch(() => {})
          await eventBus
            .emit({
              name: "partner_product.proposed",
              data: { id: prod.id, partner_id: partnerId },
            })
            .catch(() => {})
        } catch (e: any) {
          errors.push({ id: prod.id, message: e?.message ?? String(e) })
          continue
        }
      }

      changes.push(change)
    }

    const verb = dry_run ? "Would move" : "Moved"
    const summary =
      changes.length === 0
        ? "No changes — no published artisan products need normalizing"
        : `${verb} ${changes.length} artisan product(s) published → proposed (into review)` +
          (errors.length ? `; ${errors.length} error(s)` : "")

    return {
      job_id: normalizeArtisanProductsJob.id,
      dry_run,
      applied: !dry_run && changes.length > 0,
      summary,
      changes,
      ...(errors.length ? { errors } : {}),
    }
  },
}

export default normalizeArtisanProductsJob
