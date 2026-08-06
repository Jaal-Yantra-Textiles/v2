import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import {
  updateProductsWorkflow,
  updateProductVariantsWorkflow,
} from "@medusajs/medusa/core-flows"

import {
  HsCodeLevel,
  nonEmptyCode,
  resolveVariantHsCode,
  suggestHsCodeTarget,
} from "../../modules/shipping-providers/hs-code-resolution"

/**
 * Find and fill HS/HSN customs-code gaps across the catalogue.
 *
 * Shiprocket rejects EVERY international shipment whose lines lack an HSN
 * (`buildInternationalCreateBody`), and the only way to fix one at present is
 * to edit variants one at a time. That doesn't scale to a catalogue, so this is
 * the bulk half: a scan that reports exactly which items would fail and why,
 * and an apply that writes codes back at whichever level is correct for the
 * item.
 *
 * Both halves are plain container functions (not `createWorkflow`) to match the
 * shipping code they serve — `createShiprocketShipmentForFulfillment` is the
 * sibling — and both are shared by the admin route and its partner mirror so
 * the two surfaces can never drift apart (#843 recipe).
 *
 * Fixing the catalogue is retroactive: labels resolve HSN live from the DB at
 * generation time, so a code written here immediately fixes every EXISTING
 * order that uses the item. No per-order backfill is required.
 */

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

/**
 * Ids of the products linked to a sales channel.
 *
 * Scoping a product query with `filters: { sales_channels: { id } }` READS
 * correctly and is what both halves of this file originally shipped with, but
 * mikro-orm rejects it at runtime — "Trying to query by not existing property
 * Product.sales_channels" — because the relation lives on the link entity, not
 * on Product. Every partner-scoped call 500'd; nothing caught it because the
 * unit tests mock `query.graph` and so never see the filter rejected.
 *
 * The working shape is to pivot from the channel and walk `products_link`,
 * which is what `listStoreProductsWorkflow` and the price-fanout script already
 * do. Two hops (`product_variants` filtered by `"product.sales_channels.id"`)
 * fails differently — postgres "missing FROM-clause entry" — so don't reach for
 * that either.
 */
async function channelProductIds(
  query: any,
  salesChannelId: string
): Promise<string[]> {
  const { data } = await query.graph({
    entity: "sales_channel",
    fields: ["id", "products_link.product_id"],
    filters: { id: salesChannelId },
  })

  const links = ((data?.[0] as any)?.products_link || []) as Array<{
    product_id?: string
  }>

  return Array.from(
    new Set(links.map((l) => l?.product_id).filter(Boolean) as string[])
  )
}

export type HsCodeGap = {
  product_id: string
  product_title: string
  product_handle?: string | null
  variant_id: string
  variant_title?: string | null
  sku?: string | null
  /** Context for proposing a code — never invent one from the id alone. */
  description?: string | null
  material?: string | null
  product_type?: string | null
  categories: string[]
  /** Whether the variant tracks stock; drives where a code should be written. */
  manage_inventory: boolean
  /** Codes currently present at each level (all empty, or this isn't a gap). */
  current: {
    variant?: string | null
    inventory_item?: string | null
    product?: string | null
  }
  /** Where a code for this item SHOULD be written. */
  suggested_target: { level: HsCodeLevel; id: string } | null
}

export type ScanMissingHsCodesInput = {
  /** Restrict to one store's catalogue (the partner mirror always passes this). */
  salesChannelId?: string
  limit?: number
  offset?: number
}

export type ScanMissingHsCodesResult = {
  gaps: HsCodeGap[]
  /** Variants scanned in this page. */
  scanned: number
  /** Variants in this page that already resolve a code. */
  covered: number
  limit: number
  offset: number
  /** True when the page filled up, so there is likely more to scan. */
  has_more: boolean
}

/**
 * Report catalogue items that would fail an international label.
 *
 * Paginated over PRODUCTS (not variants) so a product's variants are never
 * split across pages — the caller decides a product-level write from the whole
 * variant set, and seeing half of it would produce the wrong target.
 */
export async function scanMissingHsCodes(
  container: MedusaContainer,
  input: ScanMissingHsCodesInput = {}
): Promise<ScanMissingHsCodesResult> {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

  const limit = Math.min(Math.max(Number(input.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT)
  const offset = Math.max(Number(input.offset) || 0, 0)

  // Channel-scoped scans page over the id list HERE rather than in the product
  // query: the channel pivot is the only way to resolve the set (see
  // `channelProductIds`), and once we hold it, `pagination` on the id-filtered
  // query would page a page. Unscoped (admin) scans page in the DB as before.
  let pagedIds: string[] | null = null
  let totalScopedProducts = 0

  if (input.salesChannelId) {
    const ids = await channelProductIds(query, input.salesChannelId)
    totalScopedProducts = ids.length
    pagedIds = ids.slice().sort().slice(offset, offset + limit)

    if (!pagedIds.length) {
      return { gaps: [], scanned: 0, covered: 0, limit, offset, has_more: false }
    }
  }

  const { data: products } = await query.graph({
    entity: "product",
    fields: [
      "id",
      "title",
      "handle",
      "description",
      "material",
      "hs_code",
      "type.value",
      "categories.name",
      "variants.id",
      "variants.title",
      "variants.sku",
      "variants.hs_code",
      "variants.material",
      "variants.manage_inventory",
      // Dotted, never `*inventory_items` — a star on a relation silently drops
      // it and every variant would look inventory-less.
      "variants.inventory_items.inventory_item_id",
      "variants.inventory_items.inventory.id",
      "variants.inventory_items.inventory.hs_code",
    ],
    filters: {
      ...(pagedIds ? { id: pagedIds } : {}),
    },
    ...(pagedIds ? {} : { pagination: { skip: offset, take: limit } }),
  })

  const gaps: HsCodeGap[] = []
  let scanned = 0
  let covered = 0

  for (const product of products || []) {
    for (const variant of product.variants || []) {
      scanned++

      // The variant carries no `product` relation in this shape (we came from
      // the product side), so graft it on before resolving — otherwise the
      // product rung of the chain is invisible and every unmanaged variant
      // reports as a false gap.
      const resolved = resolveVariantHsCode({
        ...variant,
        product: { hs_code: product.hs_code },
      })

      if (resolved.hs_code) {
        covered++
        continue
      }

      gaps.push({
        product_id: product.id,
        product_title: product.title,
        product_handle: product.handle,
        variant_id: variant.id,
        variant_title: variant.title,
        sku: variant.sku,
        description: product.description,
        material: variant.material || product.material,
        product_type: product.type?.value ?? null,
        categories: (product.categories || [])
          .map((c: any) => c?.name)
          .filter(Boolean),
        manage_inventory: !!variant.manage_inventory,
        current: {
          variant: variant.hs_code ?? null,
          inventory_item:
            (variant.inventory_items || [])
              .map((l: any) => l?.inventory?.hs_code)
              .find(Boolean) ?? null,
          product: product.hs_code ?? null,
        },
        suggested_target: suggestHsCodeTarget(variant, product.id),
      })
    }
  }

  return {
    gaps,
    scanned,
    covered,
    limit,
    offset,
    has_more: pagedIds
      ? offset + pagedIds.length < totalScopedProducts
      : (products || []).length === limit,
  }
}

/**
 * Split assignments into those that touch the given store's catalogue and those
 * that don't.
 *
 * The partner bulk-apply route MUST run this first. Without it, a partner could
 * post any product/variant/inventory id on the platform and rewrite another
 * seller's customs declaration — a cross-tenant write dressed up as a bulk
 * edit. Rejected rows come back as normal per-row results rather than a 403 for
 * the whole batch, so one stray id doesn't discard a legitimate batch.
 */
export async function partitionAssignmentsByStore(
  container: MedusaContainer,
  salesChannelId: string | null | undefined,
  assignments: HsCodeAssignment[]
): Promise<{ owned: HsCodeAssignment[]; foreign: HsCodeAssignment[] }> {
  if (!salesChannelId) {
    // No channel to scope by — treat everything as foreign rather than
    // defaulting open. A misconfigured store must not become a skeleton key.
    return { owned: [], foreign: [...(assignments || [])] }
  }

  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

  const productIds = await channelProductIds(query, salesChannelId)
  if (!productIds.length) {
    // An empty `id` filter is not a no-op — it would match the whole catalogue
    // and hand this partner every product on the platform.
    return { owned: [], foreign: [...(assignments || [])] }
  }

  const { data: products } = await query.graph({
    entity: "product",
    fields: [
      "id",
      "variants.id",
      "variants.inventory_items.inventory_item_id",
      "variants.inventory_items.inventory.id",
    ],
    filters: { id: productIds },
  })

  const ownedIds: Record<HsCodeLevel, Set<string>> = {
    product: new Set(),
    variant: new Set(),
    inventory_item: new Set(),
  }

  for (const product of products || []) {
    ownedIds.product.add(product.id)
    for (const variant of product.variants || []) {
      ownedIds.variant.add(variant.id)
      for (const link of variant.inventory_items || []) {
        const invId = link?.inventory?.id || link?.inventory_item_id
        if (invId) {
          ownedIds.inventory_item.add(String(invId))
        }
      }
    }
  }

  const owned: HsCodeAssignment[] = []
  const foreign: HsCodeAssignment[] = []
  for (const a of assignments || []) {
    const set = ownedIds[a?.level as HsCodeLevel]
    if (set && a?.id && set.has(String(a.id))) {
      owned.push(a)
    } else {
      foreign.push(a)
    }
  }

  return { owned, foreign }
}

export type HsCodeAssignment = {
  level: HsCodeLevel
  id: string
  hs_code: string
  origin_country?: string
  material?: string
}

export type HsCodeAssignmentResult = {
  level: HsCodeLevel
  id: string
  status: "applied" | "skipped" | "error"
  /** Why it was skipped or how it failed. Absent on success. */
  reason?: string
}

export type ApplyHsCodesResult = {
  applied: number
  skipped: number
  errors: number
  results: HsCodeAssignmentResult[]
}

const VALID_LEVELS: HsCodeLevel[] = ["variant", "inventory_item", "product"]

/**
 * Write HS codes back to the catalogue, one row at a time.
 *
 * Deliberately NOT transactional: a bad id or a since-deleted variant in a
 * hundred-row batch must not throw away the ninety-nine good writes. Every row
 * reports its own outcome so the caller can show exactly what landed — a batch
 * that silently half-applied would be worse than one that failed loudly.
 */
export async function applyHsCodes(
  container: MedusaContainer,
  assignments: HsCodeAssignment[]
): Promise<ApplyHsCodesResult> {
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  const results: HsCodeAssignmentResult[] = []

  for (const assignment of assignments || []) {
    const level = assignment?.level
    const id = assignment?.id
    const hs_code = nonEmptyCode(assignment?.hs_code)

    if (!VALID_LEVELS.includes(level)) {
      results.push({
        level,
        id,
        status: "error",
        reason: `Unknown level "${level}". Expected one of: ${VALID_LEVELS.join(", ")}.`,
      })
      continue
    }
    if (!id) {
      results.push({ level, id, status: "error", reason: "Missing id." })
      continue
    }
    if (!hs_code) {
      // Blank is a no-op, not a clear: wiping a code would break labels that
      // currently work, and nothing in this flow asks to remove one.
      results.push({
        level,
        id,
        status: "skipped",
        reason: "Blank hs_code — nothing written (this tool never clears a code).",
      })
      continue
    }

    try {
      await writeHsCode(container, level, id, {
        hs_code,
        origin_country: nonEmptyCode(assignment.origin_country),
        material: nonEmptyCode(assignment.material),
      })
      results.push({ level, id, status: "applied" })
    } catch (e: any) {
      logger?.warn?.(
        `[hs-codes] failed to set ${level} ${id} = ${hs_code}: ${e?.message}`
      )
      results.push({
        level,
        id,
        status: "error",
        reason: e?.message || "Unknown error",
      })
    }
  }

  return {
    applied: results.filter((r) => r.status === "applied").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    errors: results.filter((r) => r.status === "error").length,
    results,
  }
}

/** One write, routed to the module/workflow that owns the level. */
async function writeHsCode(
  container: MedusaContainer,
  level: HsCodeLevel,
  id: string,
  fields: { hs_code: string; origin_country?: string; material?: string }
): Promise<void> {
  const payload = {
    hs_code: fields.hs_code,
    ...(fields.origin_country ? { origin_country: fields.origin_country } : {}),
    ...(fields.material ? { material: fields.material } : {}),
  }

  if (level === "variant") {
    // Through the workflow, not the bare product service — the service has no
    // knowledge of linked modules and silently drops fields it doesn't own.
    await updateProductVariantsWorkflow(container).run({
      input: { product_variants: [{ id, ...payload }] },
    })
    return
  }

  if (level === "product") {
    await updateProductsWorkflow(container).run({
      input: { products: [{ id, ...payload }] },
    })
    return
  }

  const inventory: any = container.resolve(Modules.INVENTORY)
  if (!inventory?.updateInventoryItems) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "The inventory module does not support updating inventory items."
    )
  }
  await inventory.updateInventoryItems([{ id, ...payload }])
}
