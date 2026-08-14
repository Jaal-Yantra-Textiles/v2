import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import {
  batchInventoryItemLevelsWorkflow,
  createInventoryItemsWorkflow,
  updateProductsWorkflow,
  updateProductVariantsWorkflow,
} from "@medusajs/medusa/core-flows"

/**
 * Bulk product + variant + inventory editing in one pass.
 *
 * Editing a catalogue one variant at a time doesn't scale: "zero everything",
 * "put these 40 products live", "start tracking stock on the whole range" are
 * each dozens-to-hundreds of calls today, and a model driving them one at a
 * time will drift halfway through. This is the bulk half — plan it, review it,
 * fire it once.
 *
 * Plain container functions rather than `createWorkflow`, and shared by the
 * admin route and its partner mirror so the two surfaces can never drift apart
 * (the #843 recipe, same as `workflows/customs/hs-codes.ts`).
 *
 * ---------------------------------------------------------------------------
 * THE CORE REASON THIS FILE EXISTS
 *
 * `updateProductVariantsWorkflow` handles `manage_inventory: false` and ONLY
 * that direction — it runs `dismissProductVariantsInventoryStep`, which unlinks
 * the variant's inventory item. There is no `false → true` counterpart
 * anywhere in core-flows 2.17.2.
 *
 * So flipping the flag ON through any ordinary update path produces a variant
 * that claims to track stock and has no inventory item, no levels, and no way
 * to be stocked. The partner-ui inventory page 404s on exactly that state,
 * because its access check needs a level at the store's `default_location_id`.
 *
 * `enableInventoryTracking` below is the missing direction: set the flag,
 * create the inventory item, link variant ↔ item, then seed a level at each
 * location. Every step is skipped when it has already been done, so re-running
 * a batch is safe.
 *
 * The reverse (`manage_inventory: false`) is deliberately REFUSED here. It
 * destroys the inventory item and its levels with no undo, which is a
 * per-variant decision made with eyes open — not something to do to 400
 * variants because a selector matched them. `update_product_variant` still
 * does it one at a time.
 * ---------------------------------------------------------------------------
 */

/** Cap per call. Each product is its own workflow run; a runaway batch would
 *  hold a connection open long past any sane request timeout. */
const MAX_PRODUCTS = 200

/** Product columns a caller may set. Anything else in `update` is dropped
 *  rather than forwarded — an unknown key reaching the product module is a 500,
 *  and a bulk call is the worst place to discover one. */
const PRODUCT_FIELDS = [
  "title",
  "subtitle",
  "description",
  "handle",
  "status",
  "thumbnail",
  "material",
  "origin_country",
  "hs_code",
  "mid_code",
  "weight",
  "length",
  "height",
  "width",
  "discountable",
  "metadata",
] as const

/** Variant columns a caller may set. `manage_inventory` is handled separately
 *  (see `enableInventoryTracking`) and is not a plain passthrough. */
const VARIANT_FIELDS = [
  "title",
  "sku",
  "barcode",
  "ean",
  "upc",
  "allow_backorder",
  "hs_code",
  "origin_country",
  "mid_code",
  "material",
  "weight",
  "length",
  "height",
  "width",
  "metadata",
] as const

export type BulkVariantTarget = {
  variant_id: string
  /** Field updates for this one variant. */
  update?: Record<string, any>
}

export type BulkProductTarget = {
  product_id: string
  /** Product-level field updates. */
  update?: Record<string, any>
  /** Name specific variants. Omit to mean "every variant of this product". */
  variants?: BulkVariantTarget[]
}

export type BulkInventoryIntent = {
  /** Absolute on-hand quantity to write. NOT a delta — 0 means zero it. */
  quantity: number
  /**
   * Turn tracking on where it is off, creating the inventory item, the
   * variant ↔ item link and the levels that core never creates for an
   * existing variant. Without this, untracked variants are reported as
   * `skipped` rather than silently ignored.
   */
  ensure_managed?: boolean
  /**
   * Which stock locations to write. Defaults to every location linked to the
   * scoping sales channel. The partner mirror always pins this to its own
   * location — a partner may not write anyone else's stock.
   */
  location_ids?: string[]
}

export type BulkProductUpdateInput = {
  /** Explicit targets. Combine freely with `selector`. */
  products?: BulkProductTarget[]
  /**
   * Filter-based targeting — the "zero the whole catalogue" path. Resolved to
   * ids up front so the plan can state exactly what it matched BEFORE
   * anything is written.
   */
  selector?: {
    product_ids?: string[]
    collection_id?: string[]
    category_id?: string[]
    status?: string[]
    /** Every product in the scoping sales channel. Partner-scoped by default. */
    all?: boolean
  }
  /** Applied to every selected product. Per-product `update` wins on conflict. */
  product_update?: Record<string, any>
  /** Applied to every selected variant. Per-variant `update` wins on conflict. */
  variant_update?: Record<string, any>
  /** Applied to every selected variant. */
  set_inventory?: BulkInventoryIntent
  /** Compute and return the plan without writing anything. */
  dry_run?: boolean
}

export type BulkScope = {
  /**
   * Restrict every selector AND every explicit id to this channel's catalogue.
   * The partner mirror always passes it. Admin calls leave it undefined for
   * the whole platform.
   */
  salesChannelId?: string | null
  /** Locations the caller is allowed to write. Undefined = no restriction. */
  allowedLocationIds?: string[]
}

/** What will happen / did happen to one variant. */
export type VariantOutcome = {
  product_id: string
  variant_id: string
  sku?: string | null
  title?: string | null
  /** Ordered list of the operations this variant needs. */
  actions: string[]
  status: "planned" | "ok" | "skipped" | "error"
  reason?: string
  /** On-hand before → after, per location, when inventory is in play. */
  inventory?: {
    location_id: string
    before: number | null
    after: number
    /** Held by orders. Zeroing below this oversells — surfaced, never blocked. */
    reserved: number
  }[]
}

export type ProductOutcome = {
  product_id: string
  title?: string | null
  actions: string[]
  status: "planned" | "ok" | "skipped" | "error"
  reason?: string
}

export type BulkProductUpdateResult = {
  dry_run: boolean
  /** Products matched by ids + selector, after scoping. */
  matched_products: number
  matched_variants: number
  products: ProductOutcome[]
  variants: VariantOutcome[]
  /** Non-fatal things the caller should read before/after applying. */
  warnings: string[]
  updated: number
  skipped: number
  errors: number
}

const pick = (
  source: Record<string, any> | undefined,
  allowed: readonly string[]
): Record<string, any> => {
  const out: Record<string, any> = {}
  if (!source) return out
  for (const key of allowed) {
    if (source[key] !== undefined) out[key] = source[key]
  }
  return out
}

/**
 * Product ids linked to a sales channel.
 *
 * Filtering products by `sales_channels.id` reads correctly but mikro-orm
 * rejects it at runtime — the relation lives on the link entity, not on
 * Product. Pivot from the channel and walk `products_link` instead. Same
 * trap and same fix as `workflows/customs/hs-codes.ts`.
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

/** Stock locations linked to a sales channel. */
async function channelLocationIds(
  query: any,
  salesChannelId: string
): Promise<string[]> {
  const { data } = await query.graph({
    entity: "sales_channels",
    fields: ["stock_locations.id"],
    filters: { id: salesChannelId },
  })

  const out: string[] = []
  for (const loc of (data?.[0] as any)?.stock_locations || []) {
    if (loc?.id) out.push(loc.id)
  }
  return out
}

/**
 * Resolve the target product ids from explicit ids + selector, intersected
 * with the caller's scope.
 *
 * An out-of-scope id is dropped here and reported as an error row rather than
 * failing the batch — a partner naming someone else's product must not be able
 * to tell the difference between "not yours" and "doesn't exist", and one bad
 * id must not discard the ninety-nine good ones.
 */
async function resolveTargetIds(
  container: MedusaContainer,
  input: BulkProductUpdateInput,
  scope: BulkScope
): Promise<{ ids: string[]; rejected: string[] }> {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

  const explicit = (input.products || []).map((p) => p.product_id)
  const selector = input.selector || {}

  // PRESENCE of the key, not its truthiness, decides whether scoping applies.
  // The partner mirror always passes it; a store with a null/absent channel
  // must then own NOTHING. Branching on the value instead would turn a
  // misconfigured store into a skeleton key over the whole platform — the
  // caller looks unscoped and every product matches.
  let scopeIds: Set<string> | null = null
  if ("salesChannelId" in scope) {
    scopeIds = scope.salesChannelId
      ? new Set(await channelProductIds(query, scope.salesChannelId))
      : new Set()
  }

  const selected = new Set<string>(selector.product_ids || [])

  const needsQuery =
    selector.all ||
    selector.collection_id?.length ||
    selector.category_id?.length ||
    selector.status?.length

  if (needsQuery) {
    const filters: Record<string, any> = {}
    if (selector.collection_id?.length) {
      filters.collection_id = selector.collection_id
    }
    if (selector.category_id?.length) {
      filters.categories = { id: selector.category_id }
    }
    if (selector.status?.length) {
      filters.status = selector.status
    }
    if (scopeIds) {
      // Scope by id list rather than by channel — see channelProductIds.
      if (!scopeIds.size) {
        return { ids: [], rejected: explicit }
      }
      filters.id = Array.from(scopeIds)
    }

    const { data } = await query.graph({
      entity: "product",
      fields: ["id"],
      filters,
    })
    for (const p of (data as any[]) || []) {
      if (p?.id) selected.add(p.id)
    }
  }

  for (const id of explicit) selected.add(id)

  const ids: string[] = []
  const rejected: string[] = []
  for (const id of selected) {
    if (scopeIds && !scopeIds.has(id)) {
      rejected.push(id)
      continue
    }
    ids.push(id)
  }

  return { ids, rejected }
}

/**
 * Give an existing variant the inventory record core never creates for it.
 *
 * Order matters and each step is conditional:
 *  1. flip `manage_inventory` on (only if off)
 *  2. create an inventory item (only if the variant has none)
 *  3. link variant ↔ item (only for a freshly created item)
 *
 * Returns the inventory item id to stock, or null when one could not be
 * established.
 */
async function enableInventoryTracking(
  container: MedusaContainer,
  variant: any,
  actions: string[]
): Promise<string | null> {
  const link: any = container.resolve(ContainerRegistrationKeys.LINK)

  const existingItemId = variant.inventory_items?.find(
    (i: any) => i?.inventory?.id || i?.inventory_item_id
  )
  const alreadyLinked =
    existingItemId?.inventory?.id || existingItemId?.inventory_item_id || null

  if (!variant.manage_inventory) {
    await updateProductVariantsWorkflow(container).run({
      input: { product_variants: [{ id: variant.id, manage_inventory: true }] },
    })
    actions.push("enable_manage_inventory")
  }

  if (alreadyLinked) {
    return String(alreadyLinked)
  }

  // Mirror the shape core uses when it creates a default item at variant-create
  // time, so an item made here is indistinguishable from one made there.
  const { result } = await createInventoryItemsWorkflow(container).run({
    input: {
      items: [
        {
          sku: variant.sku || undefined,
          title: variant.title || undefined,
          description: variant.title || undefined,
          hs_code: variant.hs_code || undefined,
          origin_country: variant.origin_country || undefined,
          mid_code: variant.mid_code || undefined,
          material: variant.material || undefined,
          weight: variant.weight ?? undefined,
          length: variant.length ?? undefined,
          height: variant.height ?? undefined,
          width: variant.width ?? undefined,
          requires_shipping: true,
        },
      ],
    } as any,
  })

  const created = (result as any)?.[0] ?? (result as any)?.items?.[0]
  if (!created?.id) return null

  actions.push("create_inventory_item")

  await link.create([
    {
      [Modules.PRODUCT]: { variant_id: variant.id },
      [Modules.INVENTORY]: { inventory_item_id: created.id },
      data: { required_quantity: 1 },
    },
  ])
  actions.push("link_inventory_item")

  return String(created.id)
}

/**
 * Plan, and optionally apply, a bulk product/variant/inventory update.
 *
 * Always computes the full plan first. `dry_run` returns it untouched; an
 * apply walks the same plan, so what you review is what runs.
 */
export async function bulkUpdateProducts(
  container: MedusaContainer,
  input: BulkProductUpdateInput,
  scope: BulkScope = {}
): Promise<BulkProductUpdateResult> {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const inventoryService: any = container.resolve(Modules.INVENTORY)

  const dryRun = !!input.dry_run
  const warnings: string[] = []
  const productOutcomes: ProductOutcome[] = []
  const variantOutcomes: VariantOutcome[] = []

  if (input.variant_update?.manage_inventory === false) {
    // Refused rather than honoured: core would dismiss the inventory item and
    // take its levels with it, across every variant the selector matched.
    return {
      dry_run: dryRun,
      matched_products: 0,
      matched_variants: 0,
      products: [],
      variants: [],
      warnings: [
        "manage_inventory: false is not accepted in bulk — core dismisses the variant's inventory item and its stock levels, with no undo. Use update_product_variant per variant.",
      ],
      updated: 0,
      skipped: 0,
      errors: 1,
    }
  }

  const { ids: targetIds, rejected } = await resolveTargetIds(
    container,
    input,
    scope
  )

  for (const id of rejected) {
    productOutcomes.push({
      product_id: id,
      actions: [],
      status: "error",
      reason: "Not part of your store's catalogue.",
    })
  }

  if (targetIds.length > MAX_PRODUCTS) {
    warnings.push(
      `Selector matched ${targetIds.length} products; this call is capped at ${MAX_PRODUCTS}. Narrow the selector or page through it — nothing was written.`
    )
    return {
      dry_run: dryRun,
      matched_products: targetIds.length,
      matched_variants: 0,
      products: productOutcomes,
      variants: [],
      warnings,
      updated: 0,
      skipped: 0,
      errors: productOutcomes.length + 1,
    }
  }

  if (!targetIds.length) {
    return {
      dry_run: dryRun,
      matched_products: 0,
      matched_variants: 0,
      products: productOutcomes,
      variants: [],
      warnings: ["Nothing matched — no products were selected."],
      updated: 0,
      skipped: 0,
      errors: productOutcomes.length,
    }
  }

  const { data: products } = await query.graph({
    entity: "product",
    fields: [
      "id",
      "title",
      "status",
      "shipping_profile.id",
      "variants.id",
      "variants.title",
      "variants.sku",
      "variants.manage_inventory",
      "variants.hs_code",
      "variants.origin_country",
      "variants.mid_code",
      "variants.material",
      "variants.weight",
      "variants.length",
      "variants.height",
      "variants.width",
      "variants.inventory_items.inventory_item_id",
      "variants.inventory_items.inventory.id",
    ],
    filters: { id: targetIds },
  })

  const productsById = new Map<string, any>()
  for (const p of (products as any[]) || []) productsById.set(p.id, p)

  // Which locations inventory writes land on.
  let locationIds: string[] = input.set_inventory?.location_ids || []
  if (!locationIds.length && scope.salesChannelId) {
    locationIds = await channelLocationIds(query, scope.salesChannelId)
  }
  if (scope.allowedLocationIds) {
    const allowed = new Set(scope.allowedLocationIds)
    const dropped = locationIds.filter((l) => !allowed.has(l))
    if (dropped.length) {
      warnings.push(
        `Dropped ${dropped.length} location(s) you may not write: ${dropped.join(", ")}.`
      )
    }
    locationIds = locationIds.filter((l) => allowed.has(l))
    // A store whose own location isn't linked to its sales channel would
    // otherwise resolve to nothing and silently write no stock. The caller is
    // explicitly permitted to write these, so use them.
    if (!locationIds.length && scope.allowedLocationIds.length) {
      locationIds = [...scope.allowedLocationIds]
    }
  }
  if (input.set_inventory && !locationIds.length) {
    warnings.push(
      "No writable stock location resolved — inventory quantities were not applied. Set location_ids, or configure the store's default location."
    )
  }

  const explicitById = new Map<string, BulkProductTarget>()
  for (const p of input.products || []) explicitById.set(p.product_id, p)

  const levelsToCreate: any[] = []
  const levelsToUpdate: any[] = []

  let matchedVariants = 0

  for (const productId of targetIds) {
    const product = productsById.get(productId)
    if (!product) {
      productOutcomes.push({
        product_id: productId,
        actions: [],
        status: "error",
        reason: "Product not found.",
      })
      continue
    }

    const target = explicitById.get(productId)
    const productUpdate = {
      ...pick(input.product_update, PRODUCT_FIELDS),
      ...pick(target?.update, PRODUCT_FIELDS),
    }

    const productActions: string[] = []
    if (Object.keys(productUpdate).length) {
      productActions.push(
        ...Object.keys(productUpdate).map((k) => `product.${k}`)
      )
    }

    // Selecting specific variants means only those; omitting the key means
    // every variant, which is what makes "zero everything" a single call.
    const namedVariantIds = target?.variants?.map((v) => v.variant_id)
    const variantOverrides = new Map<string, BulkVariantTarget>()
    for (const v of target?.variants || []) variantOverrides.set(v.variant_id, v)

    const variants = (product.variants || []).filter((v: any) =>
      namedVariantIds ? namedVariantIds.includes(v.id) : true
    )

    if (!dryRun && Object.keys(productUpdate).length) {
      try {
        await updateProductsWorkflow(container).run({
          input: { products: [{ id: productId, ...productUpdate }] } as any,
        })
        productOutcomes.push({
          product_id: productId,
          title: product.title,
          actions: productActions,
          status: "ok",
        })
      } catch (e: any) {
        productOutcomes.push({
          product_id: productId,
          title: product.title,
          actions: productActions,
          status: "error",
          reason: e?.message || "Product update failed.",
        })
        // The product write failed; its variants are still independent writes
        // and are attempted below rather than abandoned.
      }
    } else {
      productOutcomes.push({
        product_id: productId,
        title: product.title,
        actions: productActions,
        status: Object.keys(productUpdate).length
          ? dryRun
            ? "planned"
            : "ok"
          : "skipped",
        reason: Object.keys(productUpdate).length
          ? undefined
          : "No product-level fields to change.",
      })
    }

    for (const variant of variants) {
      matchedVariants += 1

      const override = variantOverrides.get(variant.id)
      const variantUpdate = {
        ...pick(input.variant_update, VARIANT_FIELDS),
        ...pick(override?.update, VARIANT_FIELDS),
      }

      const actions: string[] = []
      const outcome: VariantOutcome = {
        product_id: productId,
        variant_id: variant.id,
        sku: variant.sku,
        title: variant.title,
        actions,
        status: dryRun ? "planned" : "ok",
      }

      if (Object.keys(variantUpdate).length) {
        actions.push(...Object.keys(variantUpdate).map((k) => `variant.${k}`))
      }

      const wantsInventory = !!input.set_inventory && locationIds.length > 0
      const managed = !!variant.manage_inventory
      const ensureManaged = !!input.set_inventory?.ensure_managed

      if (wantsInventory && !managed && !ensureManaged) {
        outcome.status = "skipped"
        outcome.reason =
          "Variant does not track inventory. Pass set_inventory.ensure_managed: true to turn tracking on first."
      }

      let inventoryItemId: string | null =
        variant.inventory_items?.find(
          (i: any) => i?.inventory?.id || i?.inventory_item_id
        )?.inventory?.id ??
        variant.inventory_items?.find((i: any) => i?.inventory_item_id)
          ?.inventory_item_id ??
        null

      if (wantsInventory && (managed || ensureManaged)) {
        if (!managed) actions.push("enable_manage_inventory")
        if (!inventoryItemId) {
          actions.push("create_inventory_item", "link_inventory_item")
        }
      }

      if (dryRun) {
        if (wantsInventory && (managed || ensureManaged)) {
          outcome.inventory = []
          for (const locationId of locationIds) {
            let before: number | null = null
            let reserved = 0
            if (inventoryItemId) {
              const levels = await inventoryService.listInventoryLevels({
                inventory_item_id: inventoryItemId,
                location_id: locationId,
              })
              const level = (levels as any[])?.[0]
              before = level ? Number(level.stocked_quantity) || 0 : null
              reserved = level ? Number(level.reserved_quantity) || 0 : 0
            }
            outcome.inventory.push({
              location_id: locationId,
              before,
              after: input.set_inventory!.quantity,
              reserved,
            })
            actions.push(before === null ? "create_level" : "set_quantity")
          }
        }
        if (!actions.length && outcome.status === "planned") {
          outcome.status = "skipped"
          outcome.reason = "Nothing to change."
        }
        variantOutcomes.push(outcome)
        continue
      }

      try {
        if (Object.keys(variantUpdate).length) {
          await updateProductVariantsWorkflow(container).run({
            input: {
              product_variants: [{ id: variant.id, ...variantUpdate }],
            } as any,
          })
        }

        if (wantsInventory && (managed || ensureManaged)) {
          // Re-derive rather than trusting the planned action list: another
          // call may have created the item since the graph read above.
          inventoryItemId = await enableInventoryTracking(
            container,
            variant,
            actions
          )

          if (!inventoryItemId) {
            outcome.status = "error"
            outcome.reason =
              "Could not establish an inventory item for this variant."
            variantOutcomes.push(outcome)
            continue
          }

          outcome.inventory = []
          for (const locationId of locationIds) {
            const levels = await inventoryService.listInventoryLevels({
              inventory_item_id: inventoryItemId,
              location_id: locationId,
            })
            const level = (levels as any[])?.[0]
            const before = level ? Number(level.stocked_quantity) || 0 : null
            const reserved = level ? Number(level.reserved_quantity) || 0 : 0

            if (level) {
              // Keyed on (inventory_item_id, location_id) — updateInventoryLevels
              // ignores `id`, so passing the level id alone silently no-ops.
              levelsToUpdate.push({
                inventory_item_id: inventoryItemId,
                location_id: locationId,
                stocked_quantity: input.set_inventory!.quantity,
              })
              actions.push("set_quantity")
            } else {
              levelsToCreate.push({
                inventory_item_id: inventoryItemId,
                location_id: locationId,
                stocked_quantity: input.set_inventory!.quantity,
              })
              actions.push("create_level")
            }

            outcome.inventory.push({
              location_id: locationId,
              before,
              after: input.set_inventory!.quantity,
              reserved,
            })
          }
        }

        // Don't overwrite a reason already set above — "needs ensure_managed"
        // is the one the caller has to read to fix their call, and the generic
        // line would bury it.
        if (!actions.length && !outcome.reason) {
          outcome.status = "skipped"
          outcome.reason = "Nothing to change."
        }
      } catch (e: any) {
        outcome.status = "error"
        outcome.reason = e?.message || "Variant update failed."
      }

      variantOutcomes.push(outcome)
    }
  }

  // One batched level write for the whole call rather than one per variant.
  if (!dryRun && (levelsToCreate.length || levelsToUpdate.length)) {
    try {
      await batchInventoryItemLevelsWorkflow(container).run({
        input: {
          create: levelsToCreate,
          update: levelsToUpdate,
          delete: [],
        } as any,
      })
    } catch (e: any) {
      warnings.push(
        `Inventory level write failed: ${e?.message || "unknown error"}. Field updates above still landed — re-run with the same input to retry the levels (it is idempotent).`
      )
      for (const v of variantOutcomes) {
        if (v.inventory?.length && v.status === "ok") {
          v.status = "error"
          v.reason = "Inventory level write failed for the batch."
        }
      }
    }
  }

  // Knock-on worth seeing BEFORE it surprises someone on an order screen:
  // Medusa derives requires_shipping from (shipping profile + manage_inventory).
  // A product with no profile whose variants start tracking stock changes how
  // its future fulfillments are stamped. Reported, never auto-fixed.
  if (input.set_inventory?.ensure_managed) {
    const noProfile = targetIds.filter(
      (id) => productsById.get(id) && !productsById.get(id)?.shipping_profile?.id
    )
    if (noProfile.length) {
      warnings.push(
        `${noProfile.length} product(s) have no shipping profile. Turning inventory tracking on changes how Medusa derives requires_shipping for their future fulfillments — run the backfill-product-shipping-profiles job if "Mark as shipped" goes missing.`
      )
    }
  }

  const oversold = variantOutcomes.filter((v) =>
    v.inventory?.some((l) => l.reserved > l.after)
  )
  if (oversold.length) {
    warnings.push(
      `${oversold.length} variant(s) would be set below their reserved quantity — stock already promised to open orders. Not blocked, but check those orders.`
    )
  }

  return {
    dry_run: dryRun,
    matched_products: targetIds.length,
    matched_variants: matchedVariants,
    products: productOutcomes,
    variants: variantOutcomes,
    warnings,
    updated: variantOutcomes.filter((v) => v.status === "ok").length,
    skipped: variantOutcomes.filter((v) => v.status === "skipped").length,
    errors:
      variantOutcomes.filter((v) => v.status === "error").length +
      productOutcomes.filter((p) => p.status === "error").length,
  }
}
