import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import type {
  MaintenanceChange,
  MaintenanceJob,
  MaintenanceJobResult,
} from "./registry"

/**
 * Data Plumbing — remove an ORPHAN store: one linked to no partner, holding no
 * products, no orders and no stock.
 *
 * ## Why this job exists
 *
 * A partner's store was created twice, two days apart, the first with a
 * misspelled name. The abandoned one was never linked to a partner and never
 * used — but it is not inert, because `resolveBrandLocationId()`
 * (`workflows/consumption-logs/lib/apply-to-inventory.ts`) identifies the
 * platform's brand store as *the* store with no partner link:
 *
 *     if (brandStores.length !== 1) throw ...
 *
 * Two unlinked stores therefore make that resolver throw. The same
 * `is_default: !partner` inference drives `mcp/lib/store-resolver.ts`, which is
 * why the stray also lists itself as a core storefront on the apex domain.
 *
 * There is no store DELETE route in core (`admin/stores/[id]` exports GET and
 * POST only) and none of our own, which is why this is a job rather than a
 * one-line curl.
 *
 * ## What it will NOT do
 *
 * 🔑 **Never the region.** A partner store's `default_region_id` is SHARED —
 * on prod one region backs ~10 stores — so deleting it would take out live
 * storefronts. The job deletes the store, and only those of its channel /
 * location / publishable key that belong to it alone.
 *
 * 🔑 **Never a store that is doing anything.** Products, orders, stock levels
 * or a partner link each abort that store, by name, rather than being reported
 * as a warning someone might skim past.
 *
 * ## The undo
 *
 * This docblock used to end "A store cannot be un-deleted", and that was wrong
 * in the direction that costs you an incident: the store, channel and location
 * removals are all SOFT, so they were always restorable — nobody had written
 * the restore. `restore-orphan-store` now does (#1399 item 3).
 *
 * 🔴 The publishable key is the exception, and it is not recoverable. Core
 * offers no soft delete for an api key and refuses to delete an unrevoked one,
 * so the key below is revoked and hard-deleted, and its TOKEN is gone. The
 * restore job can mint a replacement, but it is a different string.
 *
 * `store_id` is REQUIRED. There is no "find and delete all orphans" mode: an
 * inferred list of things to destroy is exactly the wrong place for inference,
 * and the brand store itself is unlinked by definition — a sweep would be one
 * bad filter away from deleting it.
 */

const paramsSchema = z.object({
  /** The store to remove. Required — deliberately no sweep mode. */
  store_id: z.string().min(1),
  /**
   * Also delete the store's own sales channel, stock location and publishable
   * key when nothing else uses them. Off by default: the store row alone is
   * what breaks the brand-store inference.
   */
  cascade: z.boolean().optional().default(false),
})

export type OrphanStoreFacts = {
  store_id: string
  store_name?: string | null
  has_partner: boolean
  product_count: number
  order_count: number
  stock_level_count: number
  sales_channel_id?: string | null
  stock_location_id?: string | null
  region_id?: string | null
  is_only_unlinked_store: boolean
}

/**
 * PURE: does this store qualify for deletion, and if not, exactly why.
 *
 * Every blocker is returned, not just the first — an operator who fixes one
 * reason and re-runs should not discover a second on the next pass.
 */
export function checkOrphanStoreDeletable(facts: OrphanStoreFacts): {
  deletable: boolean
  blockers: string[]
} {
  const blockers: string[] = []

  if (facts.has_partner) {
    blockers.push(
      `Store ${facts.store_id} IS linked to a partner — this job only removes unlinked strays.`
    )
  }
  if (facts.product_count > 0) {
    blockers.push(
      `Store ${facts.store_id} has ${facts.product_count} product(s) on its sales channel.`
    )
  }
  if (facts.order_count > 0) {
    blockers.push(
      `Store ${facts.store_id} has ${facts.order_count} order(s) on its sales channel.`
    )
  }
  if (facts.stock_level_count > 0) {
    blockers.push(
      `Store ${facts.store_id} has ${facts.stock_level_count} inventory level(s) at its stock location.`
    )
  }
  // The brand store is unlinked BY DEFINITION. If this is the only unlinked
  // store, deleting it removes the very thing resolveBrandLocationId looks for
  // — turning a throw about "found 2" into a throw about "found 0".
  if (facts.is_only_unlinked_store) {
    blockers.push(
      `Store ${facts.store_id} is the ONLY store without a partner link, which is how the platform's brand store is identified. Deleting it would break brand-location resolution rather than fix it.`
    )
  }

  return { deletable: blockers.length === 0, blockers }
}

export const deleteOrphanStoreJob: MaintenanceJob = {
  id: "delete-orphan-store",
  label: "Delete an orphan store",
  description:
    "Remove a store that is linked to no partner and holds no products, orders or stock. Refuses on any of those, and never touches the shared default region. Dry-run reports exactly what it would delete.",
  params: [
    {
      name: "store_id",
      type: "string",
      required: true,
      description: "The store to remove, e.g. 'store_...'.",
    } as any,
    {
      name: "cascade",
      type: "boolean",
      required: false,
      description:
        "Also delete its own sales channel, stock location and publishable key when nothing else uses them.",
    } as any,
  ],

  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const parsed = paramsSchema.safeParse(params)
    if (!parsed.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        parsed.error.issues.map((i) => i.message).join("; ")
      )
    }
    const { store_id, cascade } = parsed.data

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

    const { data: stores } = await query.graph({
      entity: "stores",
      fields: [
        "id",
        "name",
        "default_sales_channel_id",
        "default_location_id",
        "default_region_id",
      ],
    })
    const store = (stores ?? []).find((s: any) => s?.id === store_id)
    if (!store) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Store ${store_id} not found`
      )
    }

    // Which stores a partner owns — the same rule resolveBrandLocationId uses.
    const { data: partners } = await query.graph({
      entity: "partners",
      fields: ["id", "stores.id"],
    })
    const linkedStoreIds = new Set<string>()
    for (const p of (partners ?? []) as any[]) {
      for (const s of (p?.stores ?? []) as any[]) {
        if (s?.id) linkedStoreIds.add(s.id)
      }
    }
    const unlinkedStores = (stores ?? []).filter(
      (s: any) => s?.id && !linkedStoreIds.has(s.id)
    )

    const channelId = store.default_sales_channel_id ?? null
    const locationId = store.default_location_id ?? null

    // Products / orders on its channel, stock at its location. Counted from
    // rows, never from a `count` field: a filtered /admin/products count is
    // unreliable (a fabricated channel id returns count 1, rows 0).
    let productCount = 0
    let orderCount = 0
    if (channelId) {
      const { data: products } = await query.graph({
        entity: "product",
        fields: ["id"],
        filters: { sales_channels: { id: channelId } },
      })
      productCount = (products ?? []).length

      const { data: orders } = await query.graph({
        entity: "order",
        fields: ["id"],
        filters: { sales_channel_id: channelId },
      })
      orderCount = (orders ?? []).length
    }

    // Publishable keys on that channel, resolved up front so the DRY RUN can
    // name them. A rehearsal that omits an entity the real run deletes is a
    // rehearsal of a different job — and this is the exact entity whose
    // omission caused the 2026-08-21 storefront outage.
    let orphanKeys: Array<{ id: string; title?: string }> = []
    if (channelId) {
      const { data: keys } = await query.graph({
        entity: "api_key",
        fields: ["id", "title", "type"],
        filters: { type: "publishable", sales_channels: { id: channelId } },
      })
      orphanKeys = (keys ?? []) as any[]
    }

    let stockLevelCount = 0
    if (locationId) {
      const { data: levels } = await query.graph({
        entity: "inventory_level",
        fields: ["id"],
        filters: { location_id: locationId },
      })
      stockLevelCount = (levels ?? []).length
    }

    const facts: OrphanStoreFacts = {
      store_id,
      store_name: store.name,
      has_partner: linkedStoreIds.has(store_id),
      product_count: productCount,
      order_count: orderCount,
      stock_level_count: stockLevelCount,
      sales_channel_id: channelId,
      stock_location_id: locationId,
      region_id: store.default_region_id ?? null,
      is_only_unlinked_store: unlinkedStores.length <= 1,
    }

    const { deletable, blockers } = checkOrphanStoreDeletable(facts)

    if (!deletable) {
      return {
        job_id: deleteOrphanStoreJob.id,
        dry_run,
        applied: false,
        summary: `REFUSED — ${store.name ?? store_id} is not a deletable orphan: ${blockers.join(" ")}`,
        changes: [],
        errors: blockers.map((message) => ({ id: store_id, message })),
      }
    }

    const changes: MaintenanceChange[] = [
      {
        entity: "store",
        id: store_id,
        field: "deleted",
        before: store.name ?? store_id,
        after: "(removed)",
      },
    ]
    if (cascade) {
      // Before the channel, mirroring the deletion order — the key's link must
      // go before the thing it points at.
      for (const k of orphanKeys) {
        changes.push({
          entity: "publishable_key",
          id: k.id,
          field: "deleted",
          before: k.title ?? k.id,
          after: "(removed)",
        })
      }
      if (channelId) {
        changes.push({
          entity: "sales_channel",
          id: channelId,
          field: "deleted",
          before: channelId,
          after: "(removed)",
        })
      }
      if (locationId) {
        changes.push({
          entity: "stock_location",
          id: locationId,
          field: "deleted",
          before: locationId,
          after: "(removed)",
        })
      }
    }
    // Stated on every run so the dry-run plan is explicit about the thing most
    // worth being explicit about.
    changes.push({
      entity: "region",
      id: facts.region_id ?? "(none)",
      field: "preserved",
      before: facts.region_id ?? "(none)",
      after: "UNTOUCHED — shared with other stores",
    })

    if (dry_run) {
      return {
        job_id: deleteOrphanStoreJob.id,
        dry_run,
        applied: false,
        summary: `Would delete store ${store.name ?? store_id} (${store_id})${
          cascade ? " and its own publishable key + sales channel + stock location" : ""
        }. No products, orders or stock. Region ${facts.region_id ?? "(none)"} left untouched.`,
        changes,
        errors: [],
      }
    }

    const errors: Array<{ id: string; message: string }> = []
    const storeService: any = container.resolve("store")

    try {
      await storeService.softDeleteStores([store_id])
    } catch (err: any) {
      // Nothing else has run yet, so there is nothing to unwind.
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Failed to delete store ${store_id}: ${err?.message ?? err}`
      )
    }

    if (cascade) {
      // Best-effort, and deliberately AFTER the store: the store row is what
      // breaks brand resolution, so a channel that refuses to delete must not
      // leave the store standing.
      //
      // 🔴 The publishable key goes FIRST, before its sales channel.
      //
      // This job's description promised to remove the key and no code ever
      // did. On 2026-08-21 that took every partner storefront down: the
      // channel was deleted, the key survived pointing at it, and
      // `/web/storefront/resolve` expanded the dangling link to
      // `sales_channels: [null]` and threw. That query is unfiltered across
      // ALL publishable keys, so one orphan key broke resolution for every
      // tenant, and the edge middleware served its no-storefront 404
      // platform-wide.
      //
      // Deleting the key first means the link is gone before the channel is,
      // so the dangling state never exists — not even in the window between
      // two awaits, and not at all if the channel delete then fails.
      if (channelId) {
        try {
          const apiKeyService: any = container.resolve("api_key")
          // 🔴 `sales_channels` is a LINK, not a field on the ApiKey model —
          // the module service cannot filter on it and throws. This block used
          // `apiKeyService.listApiKeys({ sales_channels: … })`, which meant the
          // key removal this job's own comment calls load-bearing threw on its
          // first line, got converted into an error note, and left behind the
          // exact dangling link the comment describes. Only Query resolves
          // links — which is how the dry-run path 140 lines above already does
          // it, so the preview reported keys the apply could never remove.
          const { data: keys } = await query.graph({
            entity: "api_key",
            fields: ["id", "title", "revoked_at"],
            filters: { type: "publishable", sales_channels: { id: channelId } },
          })
          for (const k of keys ?? []) {
            // A publishable key cannot be deleted until it is revoked; core
            // refuses with "Cannot delete api keys that are not revoked".
            if (!k.revoked_at) {
              await apiKeyService.revoke(k.id, { revoked_by: "delete-orphan-store" })
            }
            await apiKeyService.deleteApiKeys([k.id])
          }
        } catch (err: any) {
          errors.push({
            id: channelId,
            message: `Store deleted, but its publishable key was not — this leaves a dangling sales-channel link that breaks storefront resolution for EVERY tenant; remove it by hand: ${err?.message ?? err}`,
          })
        }

        try {
          const scService: any = container.resolve("sales_channel")
          await scService.softDeleteSalesChannels([channelId])
        } catch (err: any) {
          errors.push({
            id: channelId,
            message: `Store deleted, but its sales channel was not: ${err?.message ?? err}`,
          })
        }
      }
      if (locationId) {
        try {
          const locService: any = container.resolve("stock_location")
          await locService.softDeleteStockLocations([locationId])
        } catch (err: any) {
          errors.push({
            id: locationId,
            message: `Store deleted, but its stock location was not: ${err?.message ?? err}`,
          })
        }
      }
    }

    return {
      job_id: deleteOrphanStoreJob.id,
      dry_run,
      applied: true,
      summary: `Deleted store ${store.name ?? store_id} (${store_id})${
        cascade ? " and its own publishable key + sales channel + stock location" : ""
      }. Region ${facts.region_id ?? "(none)"} untouched.${
        errors.length ? ` ${errors.length} cascade step(s) failed.` : ""
      }`,
      changes,
      errors,
    }
  },
}

export default deleteOrphanStoreJob
