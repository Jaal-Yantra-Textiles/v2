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
 * The house store is the one that belongs to no partner. That fact has a TYPED
 * home — `links/partner-stores-link.ts`, written by `create-store-with-defaults`
 * at the moment a partner store is made — and this used to ignore it, reading
 * `store.metadata.partner_id` instead (#2029 item 2). The same route writes both
 * and its own comment calls the metadata a tag "for auditing", so the blob was
 * never meant to be the decider; it just happened to be the thing being read.
 *
 * The link is now the authority, and `resolveBrandLocationId`
 * (`consumption-logs/lib/apply-to-inventory.ts`) already answers this exact
 * question that way in production — which is also the proof the links are
 * populated: were they not, every partner store would look like a brand store
 * and that helper would throw on every call. It does not.
 *
 * ⚠️ The partner read passes `withDeleted`, mirroring `resolveBrandLocationId`,
 * whose comment describes a real prod incident: a soft-deleted partner kept its
 * store and its link, that store looked ownerless, and the brand-store heuristic
 * threw until the orphan was cleaned up by hand.
 *
 * 🔑 That is INHERITED, not verified — and measuring it (see
 * `house-store-partner-link.spec.ts`) found the premise no longer holds:
 * `deletePartnerWorkflow` now deletes the partner's STORE too, and for the
 * soft-deleted partner row that remains the `stores.id` hop comes back EMPTY
 * even WITH the flag. So the flag cannot in fact recover an orphan's link. It is
 * kept because it is harmless, costs nothing and matches the sibling helper —
 * but do not rely on it, and note the same doubt applies to
 * `resolveBrandLocationId`'s own guard, which is written the same way.
 *
 * The real protection is the fallback below: if the link comes back saying
 * nothing, the blob decides, exactly as it did before this change.
 *
 * ⚠️ Metadata survives as a FALLBACK, and only for one specific reason: an empty
 * link result is indistinguishable from "no store belongs to a partner" — the
 * exact trap `partner-stores-link.ts` documents about reading links. So when the
 * link says NOTHING at all, we do not conclude that all 14 stores are ours; we
 * fall back to the blob, which is what shipped before. When the link says
 * anything, it wins outright and the blob is not consulted. That is the
 * #1554/#1557 shape the epic asks every item to land.
 *
 * ⚠️ If the answer is ever ambiguous — no candidate, or more than one — this
 * returns `null` rather than guessing. `stores[0]` is what caused the bug;
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
 *
 * `partnerStoreIds` is the set of store ids the partner↔store link claims, read
 * WITH soft-deleted partners included. Pass it and it decides. Omit it, or pass
 * an empty set, and this falls back to `metadata.partner_id` — see the header:
 * an empty link result cannot be told apart from a link read that returned
 * nothing, and treating that as "no store has an owner" would hand back a
 * platform full of house stores.
 */
export function pickHouseStore<T extends { id?: string; metadata?: any }>(
  stores: T[] | null | undefined,
  partnerStoreIds?: ReadonlySet<string> | null
): T | null {
  const byLink = !!partnerStoreIds && partnerStoreIds.size > 0
  const isPartnerStore = byLink
    ? (s: T) => partnerStoreIds!.has(String((s as any)?.id ?? ""))
    : (s: T) => !!String((s as any)?.metadata?.partner_id ?? "").trim()

  const houses = (stores ?? []).filter((s) => !isPartnerStore(s))
  return houses.length === 1 ? houses[0] : null
}

/**
 * PURE: every store id the partner↔store link accounts for.
 *
 * Shaped for `query.graph({ entity: "partners", fields: ["id", "stores.id"] })`,
 * which is how `resolveBrandLocationId` reads the same relation.
 */
export function partnerStoreIdsFrom(
  partners: any[] | null | undefined
): Set<string> {
  const ids = new Set<string>()
  for (const p of partners ?? []) {
    for (const s of (p?.stores ?? []) as any[]) {
      const id = String(s?.id ?? "").trim()
      if (id) {
        ids.add(id)
      }
    }
  }
  return ids
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
    const [{ data: stores = [] }, { data: partners = [] }] = await Promise.all([
      query.graph({
        entity: "store",
        // `metadata` is still fetched: it is the fallback when the link read
        // comes back empty, and a guard reading a field the query never asked
        // for is dead code that types perfectly (#1606).
        fields: ["id", "metadata", "supported_currencies.*"],
      }),
      // `withDeleted` mirrors `resolveBrandLocationId`. See the header: the
      // orphan it was meant to catch is no longer produced by
      // `deletePartnerWorkflow`, and the hop returns no stores for a
      // soft-deleted partner anyway — so this is belt-and-braces, not the
      // guarantee its sibling's comment claims.
      query.graph({
        entity: "partners",
        fields: ["id", "stores.id"],
        withDeleted: true,
      }),
    ])
    const house = pickHouseStore(stores, partnerStoreIdsFrom(partners)) as any
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
