import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { PARTNER_QUOTE_MODULE } from "../../../../modules/partner-quote"
import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

/**
 * #1439 S15 — make the quote tenant guard enforceable.
 *
 * ## What this is for
 *
 * `/store/b2b/quotes/:token` used to render any quote on any storefront. The
 * guard added in `quote-tenant-guard.ts` closes that, but it can only refuse a
 * PROVEN mismatch — it needs `partner_quote.store_id` on the quote and
 * `store.default_sales_channel_id` on the caller's store. Where either is
 * missing it allows and logs, because failing closed on "cannot tell" would
 * take the buyer page down for whole tenants (#1397).
 *
 * This job removes the first excuse and MEASURES the second, so the guard can
 * be tightened on evidence rather than hope.
 *
 * ## 🔴 It never guesses which store a quote belongs to
 *
 * The store is resolved from the owning partner, and ONLY when that partner has
 * exactly one. A partner with two storefronts has no derivable answer, and
 * writing the wrong one would do precisely what the guard exists to prevent —
 * pin a quote to a tenant that never sold it, making it visible on the wrong
 * shop *and* invisible on the right one. Those are reported, never written.
 *
 * ## Why it also reports stores
 *
 * `default_sales_channel_id` is the only path from a publishable key back to a
 * store, so a store missing it makes every caller unresolvable — the quote can
 * be perfectly tagged and the guard still cannot act. There is no safe
 * derivation for it (no store↔sales-channel link exists beyond that column, and
 * the stock-location path resolves nothing), so this job counts them and names
 * them. Fixing them is a deliberate act, not a backfill.
 *
 * ⚠️ Read the counts before trusting a local sample. On a dev database these
 * numbers are dominated by e2e detritus: 24 of 28 stores looked channel-less
 * until "E2E Gate Store" and friends were excluded, after which it was 0 of 2.
 * Run this with `dry_run` against the real environment and use THOSE numbers.
 */

/** Bounds the blast radius of one call. */
export const MAX_QUOTE_TENANCY_SCAN = 5000

const paramsSchema = z.object({
  /** Restrict to one partner (default: every partner with untagged quotes). */
  partner_id: z.string().min(1).optional(),
  limit: z
    .number()
    .int()
    .positive()
    .max(MAX_QUOTE_TENANCY_SCAN)
    .optional()
    .default(1000),
})

/**
 * PURE: decide one quote's store from the partner's stores.
 *
 * Exactly one store is an answer. Zero or several is a report — see the
 * docblock above for why guessing here is worse than leaving the row alone.
 */
export function resolveQuoteStore(args: {
  partnerStoreIds: string[]
}): { store_id: string | null; reason: "resolved" | "no_store" | "ambiguous" } {
  const ids = Array.from(new Set(args.partnerStoreIds.filter(Boolean)))
  if (ids.length === 1) return { store_id: ids[0], reason: "resolved" }
  if (ids.length === 0) return { store_id: null, reason: "no_store" }
  return { store_id: null, reason: "ambiguous" }
}

export const backfillQuoteTenancyJob: MaintenanceJob = {
  id: "backfill-quote-tenancy",
  label: "Backfill quote store_id (tenant isolation)",
  description:
    `Tag each partner_quote with the store that sold it, so the buyer-page tenant guard can refuse another partner's storefront (#1439 S15). The store is taken from the owning partner and ONLY when that partner has exactly one — a partner with several storefronts is reported, never guessed, because writing the wrong one hides the quote from its real buyer and shows it to a stranger. Also REPORTS stores missing default_sales_channel_id, which is the only path from a publishable key back to a store: while any exist, the guard cannot identify the caller and falls back to allowing the read. Dry-run first and read the counts — they are what tells you whether the guard can be tightened to fail closed. Scans up to 'limit' quotes per call (default 1000, max ${MAX_QUOTE_TENANCY_SCAN}).`,
  params: [
    {
      name: "partner_id",
      type: "string",
      required: false,
      description: "Restrict to a single partner (default: all)",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: `Max quotes to scan in one call (default 1000, max ${MAX_QUOTE_TENANCY_SCAN})`,
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const parsed = paramsSchema.safeParse(params)
    if (!parsed.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        parsed.error.issues.map((i) => i.message).join("; ")
      )
    }
    const { partner_id, limit } = parsed.data

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const service: any = container.resolve(PARTNER_QUOTE_MODULE)

    // ---- 1. Quotes with no store_id ---------------------------------------
    const quoteFilters: Record<string, any> = { store_id: null }
    if (partner_id) quoteFilters.partner_id = partner_id
    const untagged = await service.listPartnerQuotes(quoteFilters, {
      take: limit,
      order: { created_at: "DESC" },
    })

    // ---- 2. Their partners' stores ----------------------------------------
    const partnerIds = Array.from(
      new Set((untagged ?? []).map((q: any) => q.partner_id).filter(Boolean))
    )
    const storesByPartner = new Map<string, string[]>()
    if (partnerIds.length) {
      const { data: partners } = await query.graph({
        entity: "partners",
        fields: ["id", "stores.id"],
        filters: { id: partnerIds },
      })
      for (const p of (partners ?? []) as any[]) {
        storesByPartner.set(
          p.id,
          ((p.stores ?? []) as any[]).map((s) => s?.id).filter(Boolean)
        )
      }
    }

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []
    let resolved = 0
    let ambiguous = 0
    let noStore = 0

    for (const quote of (untagged ?? []) as any[]) {
      const { store_id, reason } = resolveQuoteStore({
        partnerStoreIds: storesByPartner.get(quote.partner_id) ?? [],
      })

      if (reason === "ambiguous") {
        ambiguous++
        errors.push({
          id: quote.id,
          message: `partner ${quote.partner_id} owns several stores — resolve by hand; guessing would pin the quote to a tenant that never sold it`,
        })
        continue
      }
      if (reason === "no_store" || !store_id) {
        noStore++
        errors.push({
          id: quote.id,
          message: `partner ${quote.partner_id} owns no store — nothing to tag it with`,
        })
        continue
      }

      changes.push({
        entity: "partner_quote",
        id: quote.id,
        field: "store_id",
        before: null,
        after: store_id,
      })
      resolved++

      if (!dry_run) {
        try {
          // 🔑 The entity form returns an object, not an array — destructuring
          // it throws AFTER the write and turns a completed job into a 500
          // that invites a retry.
          await service.updatePartnerQuotes({ id: quote.id, store_id })
        } catch (e: any) {
          errors.push({ id: quote.id, message: e?.message ?? String(e) })
        }
      }
    }

    // ---- 3. Report the other half of the guard -----------------------------
    // No derivation is attempted: there is no store↔sales-channel link beyond
    // this column, and resolving via the store's stock location returns nothing.
    const { data: allStores } = await query.graph({
      entity: "stores",
      fields: ["id", "name", "default_sales_channel_id"],
    })
    const channelless = ((allStores ?? []) as any[]).filter(
      (s) => !s?.default_sales_channel_id
    )

    const summary =
      `${dry_run ? "Would tag" : "Tagged"} ${resolved} quote(s) with their store; ` +
      `${ambiguous} ambiguous (partner owns several stores), ` +
      `${noStore} unattributable (partner owns none). ` +
      `${channelless.length} of ${(allStores ?? []).length} store(s) still lack ` +
      `default_sales_channel_id — while any remain, the tenant guard cannot ` +
      `identify the caller for those and allows the read.` +
      (channelless.length
        ? ` First few: ${channelless
            .slice(0, 5)
            .map((s) => s.name ?? s.id)
            .join(", ")}.`
        : ` The guard can be tightened to fail closed once quotes are fully tagged.`)

    return {
      job_id: "backfill-quote-tenancy",
      dry_run,
      applied: !dry_run && resolved > 0,
      summary,
      changes,
      ...(errors.length ? { errors } : {}),
    }
  },
}
