import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * Which store is OURS, and what it can actually sell in (#1979).
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * 🔴 `readStoreId` / `readStoreCurrency` both did `stores?.[0]`. This platform
 * is multi-tenant: there are 13 stores on prod, 12 of them partner tenants. So
 * "the store" was whichever row the query happened to return first, and the
 * currency an approval stamped was a LOTTERY across 13 tenants — eleven of them
 * default to INR, one to AUD, two to EUR. That is why 14 approved products came
 * out correctly denominated in INR and exactly one came out in EUR at ~110× its
 * cost. It was never reading "the store default"; it was reading a draw.
 *
 * Same family as the `take:1` profile read in #1983: a single-row read against
 * a table that has since grown more than one row.
 *
 * ── How the house store is identified ─────────────────────────────────────
 *
 * Every partner tenant carries `metadata.partner_id`. The house store is the
 * one that does NOT. On prod that is exactly one row (`JYT Medu Store`) and the
 * other twelve all carry a partner id, so the rule is unambiguous today.
 *
 * ⚠️ If it is ever ambiguous — no store without a partner id, or more than one —
 * this returns `null` rather than guessing. `stores[0]` is what caused the bug;
 * picking an arbitrary row when the answer is unclear would only re-create it in
 * a new place. Callers must treat null as "unknown", never as a default.
 */
export type HouseStore = {
  id: string
  /** Lowercased currency codes the store is able to sell in. */
  currencies: string[]
  /** The store's own default, lowercased. NOT the cost currency — see below. */
  defaultCurrency: string | null
}

/**
 * PURE: the one store that is not a partner tenant, or null if that is not a
 * single unambiguous row. Exported for tests.
 */
export function pickHouseStore<T extends { metadata?: any }>(
  stores: T[] | null | undefined
): T | null {
  const houses = (stores ?? []).filter(
    (s) => !String((s as any)?.metadata?.partner_id ?? "").trim()
  )
  return houses.length === 1 ? houses[0] : null
}

/** PURE: a store's sellable currency codes, lowercased. Exported for tests. */
export function storeCurrencies(store: any): string[] {
  return ((store?.supported_currencies ?? []) as any[])
    .map((c) => String(c?.currency_code ?? "").trim().toLowerCase())
    .filter(Boolean)
}

/** PURE: a store's own default currency, lowercased, or null. */
export function storeDefaultCurrency(store: any): string | null {
  const found = ((store?.supported_currencies ?? []) as any[]).find(
    (c) => c?.is_default
  )
  const code = String(found?.currency_code ?? "").trim().toLowerCase()
  return code || null
}

/**
 * PURE: can the house store actually sell a price denominated in this currency?
 * Exported for tests.
 *
 * 🔴 This is a GUARD, not a chooser. It never changes the currency — a cost is
 * denominated by how it was COMPUTED, and silently re-denominating it to
 * something the store prefers is precisely the #1979 defect. It only answers
 * whether the resulting price is sellable, so an unsellable one can be said out
 * loud instead of shipping quietly.
 *
 * ⚠️ An UNKNOWN house store (`null`) is not a failure: with nothing to check
 * against, the honest answer is "no objection", so this returns true. Returning
 * false would turn "we could not read the store" into a warning about a price
 * that may be perfectly fine.
 */
export function currencyIsSellable(
  currency: string,
  house: HouseStore | null
): boolean {
  if (!house) {
    return true
  }
  if (!house.currencies.length) {
    return true
  }
  return house.currencies.includes(String(currency ?? "").trim().toLowerCase())
}

/**
 * The house store, or null when it cannot be read or is ambiguous.
 *
 * Null is survivable everywhere this is used: the FX fanout is skipped and
 * `replay-fx-fanout` can materialise the prices later, and the sellability
 * guard abstains. A store we cannot read is not a reason to refuse an approval.
 */
export async function readHouseStore(container: any): Promise<HouseStore | null> {
  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
    const { data: stores = [] } = await query.graph({
      entity: "store",
      fields: ["id", "metadata", "supported_currencies.*"],
    })
    const house = pickHouseStore(stores) as any
    if (!house?.id) {
      return null
    }
    return {
      id: house.id,
      currencies: storeCurrencies(house),
      defaultCurrency: storeDefaultCurrency(house),
    }
  } catch {
    return null
  }
}
