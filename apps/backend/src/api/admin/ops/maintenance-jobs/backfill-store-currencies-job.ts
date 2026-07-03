import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { updateStoresWorkflow } from "@medusajs/medusa/core-flows"
import { z } from "@medusajs/framework/zod"

import partnerRegionLink from "../../../../links/partner-region"
import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

/**
 * #457 Data Plumbing — backfill store supported currencies.
 *
 * Guarded, UI-runnable version of
 * `src/scripts/backfill-store-currencies-from-partner-regions.ts`. Extends
 * `store.supported_currencies` so it covers every currency of a region linked
 * to the partner that owns the store.
 *
 * Why it matters (and pairs with `replay-fx-fanout`): the FX fanout only
 * writes prices in currencies present in `store.supported_currencies`. A store
 * whose Europe region is linked but whose supported_currencies is still missing
 * `eur` will never get EUR prices — so the product stays "not available" in the
 * EUR region even after a fanout replay. Run this FIRST, then replay-fx-fanout.
 *
 * Idempotent — only adds currencies that aren't already supported, and never
 * touches the `is_default` flag on existing currencies. Dry-run previews the
 * additions without persisting.
 */

/** Hard cap on partners scanned in one call — bounds the per-request blast
 *  radius (each store update runs updateStoresWorkflow). */
export const MAX_STORE_CURRENCY_SCAN = 5000

const backfillStoreCurrenciesParamsSchema = z.object({
  /** Restrict the backfill to a single partner (default: all partners). */
  partner_id: z.string().min(1).optional(),
  /** Max partners to scan in one call (1..MAX_STORE_CURRENCY_SCAN). */
  limit: z
    .number()
    .int()
    .positive()
    .max(MAX_STORE_CURRENCY_SCAN)
    .optional()
    .default(1000),
})

export type SupportedCurrency = { currency_code: string; is_default?: boolean }

/**
 * PURE: given a store's existing supported currencies and the set of currencies
 * the owning partner needs (from its linked regions), return the currencies to
 * add plus the merged next list to persist. Case-insensitive; existing entries
 * (incl. their is_default flags) are preserved verbatim; additions are
 * `is_default: false`. Mirrors the backfill script exactly.
 */
export function computeStoreCurrencyAdditions(args: {
  existing: SupportedCurrency[]
  wanted: string[]
}): { missing: string[]; next: SupportedCurrency[] } {
  const existingCodes = new Set(
    args.existing.map((c) => String(c.currency_code).toLowerCase())
  )
  const missing: string[] = []
  for (const raw of args.wanted) {
    const code = String(raw).toLowerCase()
    if (!code || existingCodes.has(code) || missing.includes(code)) continue
    missing.push(code)
  }
  const next: SupportedCurrency[] = [
    ...args.existing.map((c) => ({
      currency_code: c.currency_code,
      is_default: !!c.is_default,
    })),
    ...missing.map((code) => ({ currency_code: code, is_default: false })),
  ]
  return { missing, next }
}

export const backfillStoreCurrenciesJob: MaintenanceJob = {
  id: "backfill-store-currencies",
  label: "Backfill store supported currencies",
  description:
    `Extend each partner store's supported_currencies to cover every currency of a region linked to the owning partner. Fixes stores whose region is linked but whose currency is missing — without which FX fanout can't create prices in that currency (product stays "not available" in that region). Run this BEFORE 'Replay FX price fanout'. Dry-run previews the currencies it would add without persisting; apply merges them (idempotent — never touches existing is_default flags). Optionally scope to one partner_id. Scans up to 'limit' partners per call (default 1000, max ${MAX_STORE_CURRENCY_SCAN}).`,
  params: [
    {
      name: "partner_id",
      type: "string",
      required: false,
      description: "Restrict the backfill to a single partner (default: all partners)",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: `Max partners to scan in one call (default 1000, max ${MAX_STORE_CURRENCY_SCAN})`,
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const parsed = backfillStoreCurrenciesParamsSchema.safeParse(params)
    if (!parsed.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        parsed.error.issues.map((i) => i.message).join("; ")
      )
    }
    const { partner_id, limit } = parsed.data

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

    // 1. Partners (optionally scoped) + their stores' supported_currencies.
    const partnerGraphArgs: Record<string, unknown> = {
      entity: "partners",
      fields: [
        "id",
        "name",
        "stores.id",
        "stores.name",
        "stores.supported_currencies.currency_code",
        "stores.supported_currencies.is_default",
      ],
      pagination: { take: limit },
    }
    if (partner_id) partnerGraphArgs.filters = { id: partner_id }
    const { data: partners } = await query.graph(partnerGraphArgs as any)

    // 2. partner_region links → region currencies (two-step: the link entry
    //    point exposes region_id as a scalar, not the region relation).
    const linkFilters = partner_id ? { partner_id } : undefined
    const { data: links } = await query.graph({
      entity: partnerRegionLink.entryPoint,
      fields: ["partner_id", "region_id"],
      ...(linkFilters ? { filters: linkFilters } : {}),
    })
    const allRegionIds = Array.from(
      new Set((links ?? []).map((l: any) => l.region_id).filter(Boolean))
    )
    const regionCurrencyById = new Map<string, string>()
    if (allRegionIds.length) {
      const { data: regions } = await query.graph({
        entity: "region",
        filters: { id: allRegionIds },
        fields: ["id", "currency_code"],
      })
      for (const region of (regions ?? []) as any[]) {
        if (region?.id && region?.currency_code) {
          regionCurrencyById.set(
            region.id,
            String(region.currency_code).toLowerCase()
          )
        }
      }
    }

    // 3. partner_id → currencies it needs.
    const partnerCurrencies = new Map<string, Set<string>>()
    for (const link of (links ?? []) as any[]) {
      const currency = regionCurrencyById.get(link.region_id)
      if (!link.partner_id || !currency) continue
      if (!partnerCurrencies.has(link.partner_id)) {
        partnerCurrencies.set(link.partner_id, new Set())
      }
      partnerCurrencies.get(link.partner_id)!.add(currency)
    }

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []
    let storesUpdated = 0
    let storesAlreadyCurrent = 0
    let storesWithoutRegions = 0

    for (const partner of (partners ?? []) as any[]) {
      const wanted = partnerCurrencies.get(partner.id)
      const stores = partner.stores ?? []
      if (!stores.length) continue

      if (!wanted || wanted.size === 0) {
        storesWithoutRegions += stores.length
        continue
      }

      for (const store of stores) {
        const existing = (store.supported_currencies ?? []) as SupportedCurrency[]
        const { missing, next } = computeStoreCurrencyAdditions({
          existing,
          wanted: Array.from(wanted),
        })

        if (!missing.length) {
          storesAlreadyCurrent++
          continue
        }

        changes.push({
          entity: "store",
          id: store.id,
          field: "supported_currencies",
          before: existing.map((c) => c.currency_code).join(", "),
          after: missing.join(", "),
        })

        if (dry_run) {
          storesUpdated++
          continue
        }

        try {
          await updateStoresWorkflow(container).run({
            input: {
              selector: { id: store.id },
              update: { supported_currencies: next as any },
            },
          })
          storesUpdated++
        } catch (err: any) {
          errors.push({ id: store.id, message: err?.message ?? String(err) })
        }
      }
    }

    const verb = dry_run ? "Would add" : "Added"
    const summary = `${verb} currencies to ${storesUpdated} store(s); ${storesAlreadyCurrent} already current, ${storesWithoutRegions} with no linked regions${
      errors.length ? `, ${errors.length} error(s)` : ""
    }.`

    return {
      job_id: backfillStoreCurrenciesJob.id,
      dry_run,
      applied: !dry_run && storesUpdated > 0,
      summary,
      changes,
      errors,
    }
  },
}

export default backfillStoreCurrenciesJob
