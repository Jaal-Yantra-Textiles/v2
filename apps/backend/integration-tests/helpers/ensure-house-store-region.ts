import { Modules } from "@medusajs/framework/utils"

import { pickDefaultCurrency } from "../../src/lib/resolve-store-currency"

/**
 * Give every store a `default_region_id`, the way a real one always has —
 * and let the CURRENCY FOLLOW THE REGION, not the other way round.
 *
 * 🔴 WHY THIS EXISTS. A work order is stamped with a region, and
 * `resolveRegionAndCurrency` (dual-write-unified-run-order.ts) refuses to stamp
 * one whose currency contradicts the store's — the #2219 fix for the region
 * lottery. When the house store has no `default_region_id` it falls back to a
 * region matching the currency being stamped, and when nothing matches it
 * refuses outright: `collateRunsIntoWorkOrder` returns
 * `{ unified_order_id: null, skipped: "no_region" }` and the caller gets
 * `work_order_id: null`.
 *
 * A fresh database walks straight into that. Medusa's own defaults loader
 * creates the core store denominated in **eur** with no default region, while
 * the suites here create an **inr** region — so nothing matches, no work order
 * is minted, and every assertion that hangs off one fails.
 *
 * That state does not exist in production: `createStoreWithDefaults` sets
 * `default_region_id` on creation, and all 15 live stores carry one. So this
 * corrects the test environment rather than relaxing the guard — the guard is
 * doing exactly what it was written to do.
 *
 * 🔑 The rule applied here is **currency follows region**. The region is the
 * thing that decides tax and currency together, so the fixture adopts the
 * region that already exists and moves the store's default currency onto it.
 * Region and currency then cannot contradict each other, which is the only
 * state the guard was ever asking for. A region is minted only when there is
 * none at all to follow.
 *
 * Every store is covered rather than only the one `pickHouseStore` would
 * choose, so the fixture cannot drift out from under that decision.
 */
export const ensureHouseStoreRegion = async (container: any) => {
  const storeService: any = container.resolve(Modules.STORE)
  const regionService: any = container.resolve(Modules.REGION)

  const stores = await storeService.listStores(
    {},
    { relations: ["supported_currencies"] }
  )

  for (const store of stores) {
    if (store.default_region_id) {
      continue
    }

    /**
     * Ordered by id so two runs of the same data agree — the same reason
     * `resolveRegionAndCurrency` sorts rather than taking whatever came back
     * first. Region first, currency second.
     */
    const regions = await regionService.listRegions({})
    const region =
      [...regions].sort((a: any, b: any) =>
        String(a.id).localeCompare(String(b.id))
      )[0] ??
      (await regionService.createRegions({
        name: "Test Region",
        currency_code: pickDefaultCurrency(store, "inr"),
        // No countries: a country belongs to exactly one region, and the
        // suites create their own India region — claiming "in" here makes
        // theirs fail with "already assigned to a region".
        countries: [],
      }))

    const currencyCode = String(region.currency_code).toLowerCase()

    /**
     * ⚠️ Writing `supported_currencies` REPLACES the whole set, so the existing
     * entries are carried over with their default cleared rather than dropped —
     * only which one is default changes, plus the region's own code if the
     * store did not already list it.
     */
    const carried = (store.supported_currencies ?? []).map((c: any) => ({
      currency_code: c.currency_code,
      is_default: false,
    }))
    const supported = carried.some(
      (c: any) => String(c.currency_code).toLowerCase() === currencyCode
    )
      ? carried.map((c: any) => ({
          ...c,
          is_default:
            String(c.currency_code).toLowerCase() === currencyCode,
        }))
      : [...carried, { currency_code: currencyCode, is_default: true }]

    await storeService.updateStores(store.id, {
      default_region_id: region.id,
      supported_currencies: supported,
    })
  }
}
