import { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { ETSY_SYNC_MODULE } from "../modules/etsy-sync"
import EtsySyncService from "../modules/etsy-sync/service"
import { EtsyApiError } from "../lib/etsy-client"

// Etsy has no listing-lifecycle webhook, so we shadow it: every few hours we
// re-read the current state of each listing we track and, when it changed
// (active → sold_out / expired / inactive, or deleted on Etsy), we record the
// transition and emit an internal `etsy.listing.<state>` event that subscribers
// / visual flows can react to.

const MAX_PER_RUN = 200 // bound the daily-quota cost; log if we hit it
const DELAY_MS = 400 // pace under the ~5 qps personal-app cap (client also backs off 429s)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export default async function reconcileEtsyListingsJob(container: MedusaContainer) {
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  const service: EtsySyncService = container.resolve(ETSY_SYNC_MODULE)

  const account = await service.getActiveAccount()
  if (!account) return

  let token: string
  try {
    token = ((await service.ensureFreshToken(account)) as any).access_token
  } catch (err: any) {
    logger?.warn?.(`[etsy-reconcile] token refresh failed: ${err?.message}`)
    return
  }

  // Source of tracked listings: latest sync record per listing_id.
  const [records] = await service.listSyncRecords({}, 1000, 0)
  const latestByListing = new Map<string, any>()
  for (const r of records as any[]) {
    if (r.listing_id && !latestByListing.has(r.listing_id)) {
      latestByListing.set(r.listing_id, r)
    }
  }

  const tracked = [...latestByListing.values()]
  if (tracked.length > MAX_PER_RUN) {
    logger?.info?.(
      `[etsy-reconcile] ${tracked.length} listings tracked; reconciling first ${MAX_PER_RUN} this run`
    )
  }

  const client = service.getClient()
  const eventBus: any = container.resolve(Modules.EVENT_BUS)
  let changed = 0

  for (const rec of tracked.slice(0, MAX_PER_RUN)) {
    let currentState: string
    try {
      const listing = await client.getListing(token, rec.listing_id)
      currentState = listing.state
    } catch (err: any) {
      if (err instanceof EtsyApiError && err.status === 404) {
        currentState = "deleted"
      } else {
        logger?.warn?.(
          `[etsy-reconcile] getListing ${rec.listing_id} failed: ${err?.message}`
        )
        await sleep(DELAY_MS)
        continue
      }
    }

    const prevState = rec.listing_state ?? null
    if (currentState !== prevState) {
      changed++
      // Audit record for the transition (action/status enums are constrained).
      await service
        .createSyncRecord({
          product_id: rec.product_id,
          account_id: account.id,
          listing_id: rec.listing_id,
          listing_url: rec.listing_url ?? null,
          listing_state: currentState,
          action: "update",
          status: currentState === "deleted" ? "failed" : "success",
          published: currentState === "active",
          error_message: null,
          warnings: [],
          metadata: { reconcile: true, from: prevState, to: currentState },
          synced_at: new Date(),
        } as any)
        .catch(() => {})

      await eventBus
        .emit({
          name: `etsy.listing.${currentState}`,
          data: {
            listing_id: rec.listing_id,
            product_id: rec.product_id,
            from: prevState,
            to: currentState,
          },
        })
        .catch(() => {})

      logger?.info?.(
        `[etsy-reconcile] listing ${rec.listing_id} ${prevState} → ${currentState}`
      )
    }

    await sleep(DELAY_MS)
  }

  if (changed) logger?.info?.(`[etsy-reconcile] ${changed} listing state change(s)`)
}

export const config = {
  name: "etsy-reconcile-listings",
  schedule: "0 */3 * * *", // every 3 hours
}
