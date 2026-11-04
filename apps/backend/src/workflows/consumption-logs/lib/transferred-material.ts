import type { MedusaContainer } from "@medusajs/framework/types"

import { FULLFILLED_ORDERS_MODULE } from "../../../modules/fullfilled_orders"
import { PRODUCTION_RUNS_MODULE } from "../../../modules/production_runs"
import { resolvePartnerLocation } from "../../production-runs/lib/partner-location"
import { levelKey } from "./apply-to-inventory"

/**
 * CONSIGNMENT BY TRANSFER — the second record that says "this cloth at a
 * partner's bench is ours".
 *
 * The first is the run's material allocation (#2111). It is only written when
 * a run is approved WITH a `materials` array, and most runs are not: prod
 * 2026-11-04, Prince's denim trouser run had `materials: []`, and the 13.3 m of
 * our handloom denim had reached Prince's warehouse through two admin material
 * transfers out of Dharamshala. Completing the run consumed 6.45 m of it, and
 * the deduction skipped as "partner-held" — the stock had to be corrected by
 * hand.
 *
 * A delivered MATERIAL transfer (`goods_transfer` with `inventory_item_id`,
 * #2144) is as strong a statement as an allocation row: only an admin can
 * create one (`POST /admin/inventory-transfers`; there is no partner route),
 * and it exists only for material we already own. So a run whose partner's
 * location received this item by such a transfer may deduct it there.
 *
 * 🔴 Scoped to the RUN'S OWN PARTNER LOCATION, never "any location we ever
 * transferred to". A partner's completion may name a `location_id`; without
 * this scope, partner A's run could take our cloth off partner B's bench just
 * by naming it. And still keyed by run, for the same reason the allocation is.
 */

export type RunPartnerLocation = {
  run_id: string
  /** The run's partner's warehouse, as `resolvePartnerLocation` resolves it. */
  location_id: string | null | undefined
}

export type MaterialTransferRow = {
  inventory_item_id: string | null | undefined
  to_location_id: string | null | undefined
  status: string | null | undefined
}

/**
 * `${item}@${location}` keys, per run, for material WE transferred into that
 * run's partner location and that was counted in (`delivered`). A draft or
 * in-transit transfer has not moved stock yet, and a cancelled one never will,
 * so neither licenses a deduction.
 */
export const transferredMaterialKeysByRun = (
  runs: RunPartnerLocation[],
  transfers: MaterialTransferRow[]
): Record<string, Set<string>> => {
  const keysByLocation = new Map<string, Set<string>>()
  for (const t of transfers) {
    if (t.status !== "delivered" || !t.inventory_item_id || !t.to_location_id) {
      continue
    }
    const keys = keysByLocation.get(t.to_location_id) ?? new Set<string>()
    keys.add(levelKey(t.inventory_item_id, t.to_location_id))
    keysByLocation.set(t.to_location_id, keys)
  }

  const out: Record<string, Set<string>> = {}
  for (const run of runs) {
    const keys = run.location_id ? keysByLocation.get(run.location_id) : undefined
    if (keys?.size) {
      out[run.run_id] = new Set(keys)
    }
  }
  return out
}

/** Union two run-keyed key maps without mutating either. */
export const mergeIssuedKeys = (
  a: Record<string, Set<string>>,
  b: Record<string, Set<string>>
): Record<string, Set<string>> => {
  const out: Record<string, Set<string>> = {}
  for (const src of [a, b]) {
    for (const [runId, keys] of Object.entries(src)) {
      const merged = out[runId] ?? new Set<string>()
      keys.forEach((k) => merged.add(k))
      out[runId] = merged
    }
  }
  return out
}

/**
 * Read the runs' partner locations and the delivered material transfers into
 * them, and key them per run. Best-effort per partner: a partner whose location
 * cannot be resolved (none, or ambiguous) contributes nothing, which leaves its
 * logs exactly as they behaved before — skipped as partner-held.
 */
export const readTransferredMaterialKeysByRun = async (
  container: MedusaContainer,
  runIds: string[],
  inventoryItemIds: string[]
): Promise<Record<string, Set<string>>> => {
  if (!runIds.length || !inventoryItemIds.length) {
    return {}
  }
  // A failure here can only cost deductions, never add a wrong one: the logs
  // fall back to skipping as partner-held, exactly as before this existed.
  // Said out loud in the log rather than failing the whole apply.
  try {
    return await readKeys(container, runIds, inventoryItemIds)
  } catch (e: any) {
    const logger: any = (container as any).resolve?.("logger")
    logger?.warn?.(
      `[consumption-apply] could not read material transfers for runs ${runIds.join(", ")}: ${
        e?.message ?? e
      } — their partner-location logs skip as partner-held`
    )
    return {}
  }
}

const readKeys = async (
  container: MedusaContainer,
  runIds: string[],
  inventoryItemIds: string[]
): Promise<Record<string, Set<string>>> => {

  const runService: any = container.resolve(PRODUCTION_RUNS_MODULE)
  const runs = (await runService.listProductionRuns(
    { id: runIds },
    { select: ["id", "partner_id"], take: null }
  )) as Array<{ id: string; partner_id: string | null }>

  const locationByPartner = new Map<string, string | null>()
  for (const partnerId of new Set(runs.map((r) => r.partner_id).filter(Boolean))) {
    const resolved: any = await resolvePartnerLocation(container, partnerId as string).catch(
      () => null
    )
    locationByPartner.set(partnerId as string, resolved?.location_id ?? null)
  }

  const runLocations: RunPartnerLocation[] = runs.map((r) => ({
    run_id: r.id,
    location_id: r.partner_id ? locationByPartner.get(r.partner_id) : null,
  }))
  const locationIds = Array.from(
    new Set(runLocations.map((r) => r.location_id).filter(Boolean))
  ) as string[]
  if (!locationIds.length) {
    return {}
  }

  const transferService: any = container.resolve(FULLFILLED_ORDERS_MODULE)
  const transfers = (await transferService.listGoodsTransfers(
    {
      inventory_item_id: inventoryItemIds,
      to_location_id: locationIds,
      status: "delivered",
    },
    { select: ["inventory_item_id", "to_location_id", "status"], take: null }
  )) as MaterialTransferRow[]

  return transferredMaterialKeysByRun(runLocations, transfers)
}
