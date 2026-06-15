import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { resolveShippingProvider } from "../modules/shipping-providers/resolver"
import {
  pickupNicknameForLocation,
  SHIPROCKET_PICKUP_METADATA_KEY,
} from "../modules/shipping-providers/pickup-locations"
import { PickupLocation } from "../modules/shipping-providers/provider-interface"

/**
 * Map pre-registered Shiprocket pickup locations onto our stock locations
 * (#31, SHIPPING_PROVIDERS.md §9).
 *
 * Many warehouses already exist in our Shiprocket account (added by hand on the
 * dashboard before this feature). This backfill records the carrier nickname on
 * `stock_location.metadata.shiprocket_pickup_location` so existing
 * partners/stores are wired up WITHOUT re-registering (which would fail on the
 * unique-nickname constraint anyway).
 *
 * Matching (first hit wins, per location):
 *   1. metadata already set            → skip (idempotent)
 *   2. exact nickname `warehouse-<sfx>`→ deterministic scheme (same as Delhivery)
 *   3. unique pincode match            → single Shiprocket pickup on that pin
 *   4. unique (city + pincode) match   → narrows when a pin has several pickups
 * Ambiguous (>1 candidate) and unmatched locations are reported, never guessed.
 *
 * Run:
 *   npx medusa exec ./src/scripts/backfill-shiprocket-pickup-locations.ts
 * Dry run (reports, writes nothing):
 *   npx medusa exec ./src/scripts/backfill-shiprocket-pickup-locations.ts -- --dry-run
 *   DRY_RUN=1 npx medusa exec ./src/scripts/backfill-shiprocket-pickup-locations.ts
 */
export default async function backfillShiprocketPickupLocations({
  container,
  args,
}: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const stockLocationService = container.resolve(Modules.STOCK_LOCATION) as any

  const dryRun =
    (args ?? []).includes("--dry-run") || process.env.DRY_RUN === "1"
  if (dryRun) logger.info("[shiprocket-backfill] DRY RUN — no metadata written.")

  // 1. Pull every registered Shiprocket pickup.
  let pickups: PickupLocation[] = []
  try {
    const provider = await resolveShippingProvider(container, "shiprocket")
    if (!provider.listPickupLocations) {
      logger.error("[shiprocket-backfill] provider has no listPickupLocations()")
      return
    }
    pickups = await provider.listPickupLocations()
  } catch (e: any) {
    logger.error(
      `[shiprocket-backfill] could not list Shiprocket pickups: ${e?.message}`
    )
    return
  }
  logger.info(`[shiprocket-backfill] ${pickups.length} Shiprocket pickup(s) found`)
  if (!pickups.length) return

  const byNickname = new Map(pickups.map((p) => [p.name, p]))
  const byPincode = new Map<string, PickupLocation[]>()
  for (const p of pickups) {
    if (!p.pincode) continue
    const list = byPincode.get(p.pincode) || []
    list.push(p)
    byPincode.set(p.pincode, list)
  }

  // 2. Every stock location with its address + metadata.
  const { data: locations } = await query.graph({
    entity: "stock_location",
    fields: ["id", "name", "metadata", "address.*"],
  })

  let mapped = 0
  let skipped = 0
  const ambiguous: string[] = []
  const unmatched: string[] = []

  for (const loc of (locations || []) as any[]) {
    const label = `${loc.name || "(unnamed)"} [${loc.id}]`
    if (loc.metadata?.[SHIPROCKET_PICKUP_METADATA_KEY]) {
      skipped++
      continue
    }

    const addr = loc.address || {}
    const pin = addr.postal_code as string | undefined
    const city = (addr.city as string | undefined)?.toLowerCase()

    let match: PickupLocation | undefined
    let how = ""

    // 2a. deterministic nickname
    const nickname = pickupNicknameForLocation(loc.id)
    if (byNickname.has(nickname)) {
      match = byNickname.get(nickname)
      how = "nickname"
    }

    // 2b/2c. pincode (optionally narrowed by city)
    if (!match && pin) {
      const candidates = byPincode.get(pin) || []
      if (candidates.length === 1) {
        match = candidates[0]
        how = "pincode"
      } else if (candidates.length > 1 && city) {
        const narrowed = candidates.filter(
          (c) => (c.city || "").toLowerCase() === city
        )
        if (narrowed.length === 1) {
          match = narrowed[0]
          how = "pincode+city"
        } else if (narrowed.length > 1) {
          ambiguous.push(`${label} — ${narrowed.length} pickups on ${pin}/${city}`)
        }
      } else if (candidates.length > 1) {
        ambiguous.push(`${label} — ${candidates.length} pickups on pincode ${pin}`)
      }
    }

    if (!match) {
      unmatched.push(label)
      continue
    }

    const verified = match.phone_verified === false ? " (phone UNVERIFIED)" : ""
    logger.info(
      `[shiprocket-backfill] ${dryRun ? "would map" : "mapping"} ${label} → "${match.name}" via ${how}${verified}`
    )
    if (!dryRun) {
      await stockLocationService.updateStockLocations(loc.id, {
        metadata: {
          ...(loc.metadata || {}),
          [SHIPROCKET_PICKUP_METADATA_KEY]: match.name,
        },
      })
    }
    mapped++
  }

  logger.info(
    `[shiprocket-backfill] done — ${mapped} mapped, ${skipped} already set, ${ambiguous.length} ambiguous, ${unmatched.length} unmatched`
  )
  if (ambiguous.length) {
    logger.warn(`[shiprocket-backfill] ambiguous (resolve manually):`)
    ambiguous.forEach((a) => logger.warn(`  - ${a}`))
  }
  if (unmatched.length) {
    logger.info(`[shiprocket-backfill] unmatched (no Shiprocket pickup found):`)
    unmatched.forEach((u) => logger.info(`  - ${u}`))
  }
}
