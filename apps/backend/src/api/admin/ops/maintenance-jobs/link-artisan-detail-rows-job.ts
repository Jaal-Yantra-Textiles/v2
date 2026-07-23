import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { ARTISAN_PRODUCT_DETAIL_MODULE } from "../../../../modules/artisan-product-detail"
import type {
  MaintenanceChange,
  MaintenanceJob,
  MaintenanceJobResult,
} from "./registry"

/**
 * #859 Data Plumbing — create missing product ↔ artisan_product_detail links.
 *
 * The storefront resolves the maker story / made-to-order block through the
 * product↔detail LINK (query.graph alias `artisan_product_detail`), NOT the
 * detail row's `product_id` column. The upsert workflow originally created the
 * link only on first-create, so any detail row whose link never persisted
 * (link-migration lag, or a create that failed to link) stayed unlinked
 * forever: readable by the module via `product_id`, but invisible to
 * query.graph — the maker story silently vanished from the storefront.
 *
 * The upsert workflow now ensures the link on every save; this heals existing
 * rows. Idempotent — products already linked (verified via the same query.graph
 * the storefront uses) are skipped. Dry-run lists what WOULD be linked without
 * writing.
 */

/** Hard cap on detail rows scanned in one call — bounds per-request blast radius. */
export const MAX_ARTISAN_LINK_SCAN = 10000

const paramsSchema = z.object({
  /** Restrict to a single product. */
  product_id: z.string().min(1).optional(),
  /** Max detail rows to scan in one call. */
  limit: z
    .number()
    .int()
    .positive()
    .max(MAX_ARTISAN_LINK_SCAN)
    .optional()
    .default(1000),
})

export const linkArtisanDetailRowsJob: MaintenanceJob = {
  id: "link-artisan-detail-rows",
  label: "Link artisan detail rows (heal missing maker-story links)",
  description:
    `Create the product ↔ artisan_product_detail link for detail rows that are missing it, so the maker story / made-to-order block hydrates on the storefront. Targets ONLY rows whose product-side query.graph relation is absent (the exact reason the maker story silently dropped — the link, not the product_id column, drives storefront hydration). Already-linked rows are skipped. Apply creates the link; dry-run lists what would be linked. Optionally scope to one product_id. Scans up to 'limit' detail rows (default 1000, max ${MAX_ARTISAN_LINK_SCAN}).`,
  params: [
    {
      name: "product_id",
      type: "string",
      required: false,
      description: "Restrict to a single product (default: all artisan detail rows)",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: `Max detail rows to scan in one call (default 1000, max ${MAX_ARTISAN_LINK_SCAN})`,
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
    const { product_id, limit } = parsed.data

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const link: any = container.resolve(ContainerRegistrationKeys.LINK)
    const service: any = container.resolve(ARTISAN_PRODUCT_DETAIL_MODULE)

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []

    const details: any[] = await service.listArtisanProductDetails(
      product_id ? { product_id } : {},
      { take: limit }
    )

    for (const d of details) {
      const productId = d?.product_id
      if (!productId) {
        errors.push({ id: d?.id ?? "unknown", message: "detail row has no product_id" })
        continue
      }
      try {
        // Check the relation exactly as the storefront does — through the link,
        // not the column — so we only create links that are genuinely missing.
        const { data: products = [] } = await query.graph({
          entity: "product",
          fields: ["id", "artisan_product_detail.id"],
          filters: { id: productId },
        })
        const product = products[0] as any
        if (!product) {
          errors.push({ id: productId, message: "product not found" })
          continue
        }
        if (product.artisan_product_detail?.id) {
          continue // already linked
        }

        const change: MaintenanceChange = {
          entity: "product",
          id: productId,
          field: "artisan_product_detail_link",
          before: "missing",
          after: "linked",
        }

        if (!dry_run) {
          await link.create({
            [Modules.PRODUCT]: { product_id: productId },
            [ARTISAN_PRODUCT_DETAIL_MODULE]: { artisan_product_detail_id: d.id },
          })
        }

        changes.push(change)
      } catch (e: any) {
        errors.push({ id: productId, message: e?.message ?? String(e) })
      }
    }

    const verb = dry_run ? "Would link" : "Linked"
    const summary =
      changes.length === 0
        ? "No changes — every artisan detail row is already linked"
        : `${verb} ${changes.length} artisan detail row(s) to their product` +
          (errors.length ? `; ${errors.length} error(s)` : "")

    return {
      job_id: linkArtisanDetailRowsJob.id,
      dry_run,
      applied: !dry_run && changes.length > 0,
      summary,
      changes,
      ...(errors.length ? { errors } : {}),
    }
  },
}

export default linkArtisanDetailRowsJob
