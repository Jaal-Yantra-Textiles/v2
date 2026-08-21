import { MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"
import {
  createApiKeysWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
} from "@medusajs/medusa/core-flows"

import type {
  MaintenanceChange,
  MaintenanceJob,
  MaintenanceJobResult,
} from "./registry"

/**
 * Data Plumbing — the UNDO that `delete-orphan-store` never had.
 *
 * ## Why this exists
 *
 * On 2026-08-21 `delete-orphan-store` was run against prod without anyone
 * first confirming a restore path existed. It did not: nothing in the codebase
 * called `restoreStores`, `restoreSalesChannels` or `restoreStockLocations`,
 * and the job's own docblock said "a store cannot be un-deleted".
 *
 * That was half true, and the half that was false is the dangerous half. All
 * three of those removals are SOFT — the rows are intact with `deleted_at`
 * set — so the restore was always mechanically available; it simply had never
 * been written. The run then took every partner storefront on the platform
 * down, and the absence of an undo turned a two-minute mistake into an
 * incident.
 *
 * 🔑 **Verify the undo works before running the do.** This job is the undo.
 *
 * ## What it cannot bring back
 *
 * 🔴 **The publishable key.** `delete-orphan-store` HARD-deletes it
 * (`deleteApiKeys`), because core refuses to delete an unrevoked key and offers
 * no soft delete for one. That row is gone, and its token with it.
 *
 * `recreate_publishable_key` mints a NEW key and links it to the restored
 * channel. That genuinely restores service — `/web/storefront/resolve` reads
 * the token from the database on every request, so storefronts pick it up
 * without redeployment — but the token STRING is different. Anything that
 * hard-coded the old one stays broken, and this job cannot tell you what did.
 * It is opt-in for that reason: silently minting a credential is not a restore.
 */

const paramsSchema = z.object({
  /** The soft-deleted store to bring back. */
  store_id: z.string().min(1),
  /** Restore its sales channel too. On by default — a store without its channel serves nothing. */
  restore_sales_channel: z.boolean().optional().default(true),
  /** Restore its stock location too. */
  restore_stock_location: z.boolean().optional().default(true),
  /**
   * Mint a NEW publishable key and link it to the restored channel. Off by
   * default: the original token is unrecoverable and the replacement differs.
   */
  recreate_publishable_key: z.boolean().optional().default(false),
})

export type OrphanStoreRestoreFacts = {
  store_id: string
  store_name?: string | null
  /** Whether the store row exists at all, once soft-deleted rows are included. */
  store_exists: boolean
  /** Whether it is actually deleted. Restoring a live store is a no-op worth refusing. */
  store_deleted: boolean
  sales_channel_id?: string | null
  sales_channel_deleted: boolean
  stock_location_id?: string | null
  stock_location_deleted: boolean
  /** Publishable keys currently linked to that channel — usually none, post-deletion. */
  linked_key_count: number
}

/**
 * PURE: can this store be restored, and if not, exactly why.
 *
 * Every blocker is returned, not just the first — the same rule the deletion
 * side follows, for the same reason.
 */
export function checkOrphanStoreRestorable(facts: OrphanStoreRestoreFacts): {
  restorable: boolean
  blockers: string[]
  warnings: string[]
} {
  const blockers: string[] = []
  const warnings: string[] = []

  if (!facts.store_exists) {
    blockers.push(
      `Store ${facts.store_id} does not exist, deleted or otherwise — there is nothing to restore.`
    )
    return { restorable: false, blockers, warnings }
  }
  if (!facts.store_deleted) {
    blockers.push(
      `Store ${facts.store_id} is not deleted. Restoring a live store would change nothing and hide a mistyped id.`
    )
  }

  // Not blockers: a partial restore is still a restore, and refusing one
  // because a single sibling row is already healthy would be unhelpful during
  // exactly the kind of incident this job exists for.
  if (facts.sales_channel_id && !facts.sales_channel_deleted) {
    warnings.push(
      `Sales channel ${facts.sales_channel_id} is already live — leaving it alone.`
    )
  }
  if (!facts.sales_channel_id) {
    warnings.push(
      `Store ${facts.store_id} has no default sales channel recorded, so none can be restored. Its storefront will not resolve until one is attached.`
    )
  }
  if (facts.stock_location_id && !facts.stock_location_deleted) {
    warnings.push(
      `Stock location ${facts.stock_location_id} is already live — leaving it alone.`
    )
  }
  if (facts.linked_key_count === 0) {
    warnings.push(
      `No publishable key is linked to this store's channel. delete-orphan-store HARD-deletes the key, so the original token is unrecoverable; pass recreate_publishable_key to mint a new one.`
    )
  }

  return { restorable: blockers.length === 0, blockers, warnings }
}

export const restoreOrphanStoreJob: MaintenanceJob = {
  id: "restore-orphan-store",
  label: "Restore a deleted store",
  description:
    "Undo delete-orphan-store: restore the soft-deleted store, its sales channel and its stock location. The publishable key was hard-deleted and cannot be recovered — optionally mint a replacement. Dry-run reports exactly what it would restore.",
  params: [
    {
      name: "store_id",
      type: "string",
      required: true,
      description: "The soft-deleted store to bring back, e.g. 'store_...'.",
    } as any,
    {
      name: "restore_sales_channel",
      type: "boolean",
      required: false,
      description: "Restore its sales channel too. Default true.",
    } as any,
    {
      name: "restore_stock_location",
      type: "boolean",
      required: false,
      description: "Restore its stock location too. Default true.",
    } as any,
    {
      name: "recreate_publishable_key",
      type: "boolean",
      required: false,
      description:
        "Mint a NEW publishable key and link it to the restored channel. The original token is unrecoverable; the replacement is a different string.",
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
    const {
      store_id,
      restore_sales_channel,
      restore_stock_location,
      recreate_publishable_key,
    } = parsed.data

    const storeService: any = container.resolve("store")
    const scService: any = container.resolve("sales_channel")
    const locService: any = container.resolve("stock_location")
    const apiKeyService: any = container.resolve("api_key")

    // `withDeleted` is opt-in everywhere in Medusa, and the row we are looking
    // for is by definition deleted — reading it without this returns nothing
    // and looks exactly like "no such store".
    const stores = await storeService.listStores(
      { id: [store_id] },
      { withDeleted: true }
    )
    const store = (stores ?? [])[0]

    const channelId = store?.default_sales_channel_id ?? null
    const locationId = store?.default_location_id ?? null

    let channel: any = null
    if (channelId) {
      const rows = await scService.listSalesChannels(
        { id: [channelId] },
        { withDeleted: true }
      )
      channel = (rows ?? [])[0] ?? null
    }

    let location: any = null
    if (locationId) {
      const rows = await locService.listStockLocations(
        { id: [locationId] },
        { withDeleted: true }
      )
      location = (rows ?? [])[0] ?? null
    }

    let linkedKeyCount = 0
    if (channelId) {
      const keys = await apiKeyService.listApiKeys({
        type: "publishable",
        sales_channels: { id: channelId },
      })
      linkedKeyCount = (keys ?? []).length
    }

    const facts: OrphanStoreRestoreFacts = {
      store_id,
      store_name: store?.name ?? null,
      store_exists: Boolean(store),
      store_deleted: Boolean(store?.deleted_at),
      sales_channel_id: channelId,
      sales_channel_deleted: Boolean(channel?.deleted_at),
      stock_location_id: locationId,
      stock_location_deleted: Boolean(location?.deleted_at),
      linked_key_count: linkedKeyCount,
    }

    const { restorable, blockers, warnings } =
      checkOrphanStoreRestorable(facts)

    if (!restorable) {
      return {
        job_id: restoreOrphanStoreJob.id,
        dry_run,
        applied: false,
        summary: `REFUSED — ${store?.name ?? store_id} cannot be restored: ${blockers.join(" ")}`,
        changes: [],
        errors: blockers.map((message) => ({ id: store_id, message })),
      }
    }

    const willRestoreChannel =
      restore_sales_channel && Boolean(channelId) && facts.sales_channel_deleted
    const willRestoreLocation =
      restore_stock_location && Boolean(locationId) && facts.stock_location_deleted

    const changes: MaintenanceChange[] = []
    if (willRestoreChannel) {
      changes.push({
        entity: "sales_channel",
        id: channelId as string,
        field: "deleted_at",
        before: "(deleted)",
        after: "(restored)",
      })
    }
    if (willRestoreLocation) {
      changes.push({
        entity: "stock_location",
        id: locationId as string,
        field: "deleted_at",
        before: "(deleted)",
        after: "(restored)",
      })
    }
    changes.push({
      entity: "store",
      id: store_id,
      field: "deleted_at",
      before: "(deleted)",
      after: "(restored)",
    })
    if (recreate_publishable_key && channelId) {
      changes.push({
        entity: "api_key",
        id: "(new)",
        field: "created",
        before: "(hard-deleted, token unrecoverable)",
        after: "NEW publishable key linked to the restored channel",
      })
    }

    if (dry_run) {
      return {
        job_id: restoreOrphanStoreJob.id,
        dry_run,
        applied: false,
        summary: `Would restore store ${store?.name ?? store_id} (${store_id})${
          willRestoreChannel ? " + its sales channel" : ""
        }${willRestoreLocation ? " + its stock location" : ""}${
          recreate_publishable_key && channelId
            ? " and mint a NEW publishable key (different token)"
            : ""
        }.`,
        changes,
        errors: warnings.map((message) => ({ id: store_id, message })),
      }
    }

    const errors: Array<{ id: string; message: string }> = warnings.map(
      (message) => ({ id: store_id, message })
    )

    // Channel and location come back BEFORE the store, mirroring the deletion
    // order in reverse: the store is what other resolvers look at, so it must
    // not become visible while the things it points at are still deleted.
    if (willRestoreChannel) {
      try {
        await scService.restoreSalesChannels([channelId])
      } catch (err: any) {
        errors.push({
          id: channelId as string,
          message: `Could not restore the sales channel: ${err?.message ?? err}`,
        })
      }
    }
    if (willRestoreLocation) {
      try {
        await locService.restoreStockLocations([locationId])
      } catch (err: any) {
        errors.push({
          id: locationId as string,
          message: `Could not restore the stock location: ${err?.message ?? err}`,
        })
      }
    }

    try {
      await storeService.restoreStores([store_id])
    } catch (err: any) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Failed to restore store ${store_id}: ${err?.message ?? err}`
      )
    }

    let newKeyToken: string | null = null
    if (recreate_publishable_key && channelId) {
      try {
        const { result } = await createApiKeysWorkflow(container).run({
          input: {
            api_keys: [
              {
                title: `${store?.name ?? store_id} storefront (restored)`,
                type: "publishable",
                created_by: "restore-orphan-store",
              },
            ],
          },
        })
        const created = (result as any[])?.[0]
        if (created?.id) {
          // Link only AFTER the channel is back — a key pointing at a
          // soft-deleted channel is the exact dangling state that 500'd every
          // storefront on 2026-08-21.
          await linkSalesChannelsToApiKeyWorkflow(container).run({
            input: { id: created.id, add: [channelId], remove: [] },
          })
          newKeyToken = created.token ?? null
        }
      } catch (err: any) {
        errors.push({
          id: channelId as string,
          message: `Store restored, but the replacement publishable key was not created: ${err?.message ?? err}`,
        })
      }
    }

    return {
      job_id: restoreOrphanStoreJob.id,
      dry_run,
      applied: true,
      summary: `Restored store ${store?.name ?? store_id} (${store_id})${
        willRestoreChannel ? " + its sales channel" : ""
      }${willRestoreLocation ? " + its stock location" : ""}${
        newKeyToken ? ` with a NEW publishable key ${newKeyToken}` : ""
      }.${errors.length ? ` ${errors.length} note(s)/failure(s) — read them.` : ""}`,
      changes,
      errors,
    }
  },
}

export default restoreOrphanStoreJob
