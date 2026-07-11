import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

/**
 * #457 Data Plumbing — repair shipping-option store visibility (enabled_in_store).
 *
 * THE BUG
 * -------
 * The partner shipping provisioning paths (create-store-with-defaults, the
 * backfill script AND its DP job, and the medusa starter seed) wrote the
 * `enabled_in_store` rule value as the JSON-quoted string `'"true"'` instead of
 * the plain `"true"` the medusa dashboard uses. Because the value column is
 * JSONB, `'"true"'` is persisted DOUBLE-encoded as `"\"true\""` (6 chars incl.
 * quotes), while the store/cart visibility filter compares the context value
 * `` `${true}` === "true" `` (4 chars) — see fulfillment `isContextValid` and
 * core-flows `list-shipping-options-for-cart` (context.enabled_in_store = "true").
 * The extra quotes never match → every affected option is invisible in the
 * store ("switched off") even though the rule exists.
 *
 * The sibling `is_return` rule was written plain (`"false"`) all along, so only
 * `enabled_in_store` is affected. Source paths are fixed to emit plain `"true"`;
 * this job repairs the rows already written (the backfill DP was run in prod).
 *
 * WHAT IT DOES
 * ------------
 * Rewrites every `enabled_in_store` shipping_option_rule whose stored value is
 * malformed (any JSON-quote-wrapped form that decodes to a boolean) back to its
 * canonical plain `"true"`/`"false"`. A correctly-stored `"true"` (enabled) or
 * `"false"` (intentionally disabled via the dashboard) is left untouched — so
 * this does NOT force-enable options an operator deliberately turned off; it
 * only un-breaks the double-encoded ones (all of which were created as enabled).
 *
 * Dry-run (default) previews every before→after without writing; apply is
 * idempotent (re-running once values are canonical is a no-op).
 */

/** Hard cap on rules scanned in one call. */
export const MAX_RULE_SCAN = 20000

const ENABLED_ATTR = "enabled_in_store"

const paramsSchema = z.object({
  /** Max enabled_in_store rules to scan in one call. */
  limit: z.number().int().positive().max(MAX_RULE_SCAN).optional().default(MAX_RULE_SCAN),
})

/**
 * PURE: decode a stored rule value to its canonical boolean-string intent
 * ("true"/"false"), peeling any number of surrounding JSON-quote layers, or
 * null when the value is not a recognizable boolean. Exported for unit tests.
 *
 *   true            → "true"     (boolean, pre-normalization)
 *   "true"          → "true"     (canonical — what the store expects)
 *   '"true"'        → "true"     (the double-encoded bug: JSONB "\"true\"")
 *   '""true""'      → "true"     (defensively, deeper nesting)
 *   "false"         → "false"
 *   "banana" / {}   → null
 */
export function decodeRuleBool(value: unknown): "true" | "false" | null {
  if (value === true) return "true"
  if (value === false) return "false"
  if (typeof value !== "string") return null
  let v = value.trim()
  while (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    v = v.slice(1, -1).trim()
  }
  if (v === "true") return "true"
  if (v === "false") return "false"
  return null
}

/**
 * PURE: the canonical plain value the store filter matches, or null when the
 * value is unrecognizable (left untouched). Exported for unit tests.
 */
export function canonicalRuleValue(value: unknown): "true" | "false" | null {
  return decodeRuleBool(value)
}

/**
 * PURE: does this stored value need a rewrite? True only when it decodes to a
 * boolean AND is not already stored as that exact plain string. Exported for
 * unit tests.
 */
export function needsStoreVisibilityRepair(value: unknown): boolean {
  const canon = decodeRuleBool(value)
  return canon !== null && value !== canon
}

export const repairShippingOptionStoreVisibilityJob: MaintenanceJob = {
  id: "repair-shipping-option-store-visibility",
  label: "Repair shipping option store visibility (enabled_in_store)",
  description:
    "Fix shipping options that are invisible in the store because their enabled_in_store rule was written JSON-quoted ('\"true\"' → stored double-encoded) instead of the plain \"true\" the store visibility filter matches. Rewrites every malformed enabled_in_store rule back to its canonical plain value (enabling the ones created by the partner shipping backfill / store provisioning). Correctly-stored \"true\"/\"false\" rules are left untouched — an intentionally-disabled option is NOT re-enabled. Dry-run previews the before/after; apply is idempotent.",
  params: [
    {
      name: "limit",
      type: "number",
      required: false,
      description: `Max enabled_in_store rules to scan in one call (default & max ${MAX_RULE_SCAN})`,
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
    const { limit } = parsed.data

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const fulfillment: any = container.resolve(Modules.FULFILLMENT)

    const { data: rules } = await query.graph({
      entity: "shipping_option_rule",
      fields: ["id", "value", "operator", "shipping_option.id", "shipping_option.name"],
      filters: { attribute: ENABLED_ATTR },
      pagination: { take: limit },
    })

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []
    let enabledCount = 0

    for (const rule of (rules || []) as any[]) {
      if (!needsStoreVisibilityRepair(rule.value)) continue
      const after = canonicalRuleValue(rule.value)!
      if (after === "true") enabledCount++
      changes.push({
        entity: "shipping_option_rule",
        id: rule.id,
        field: `${ENABLED_ATTR} (option ${rule.shipping_option?.name ?? rule.shipping_option?.id ?? "?"})`,
        before: rule.value,
        after,
      })
      if (!dry_run) {
        try {
          // updateShippingOptionRules re-validates the whole rule (attribute +
          // operator + value all required), so pass the full shape, not {id,value}.
          await fulfillment.updateShippingOptionRules([
            { id: rule.id, attribute: ENABLED_ATTR, operator: rule.operator ?? "eq", value: after },
          ])
        } catch (e: any) {
          errors.push({ id: rule.id, message: e?.message ?? String(e) })
        }
      }
    }

    const scanned = (rules || []).length
    const summary =
      changes.length === 0
        ? `No changes — scanned ${scanned} enabled_in_store rule(s), all already canonical (store-visible)`
        : `${dry_run ? "Would repair" : "Repaired"} ${changes.length} malformed enabled_in_store rule(s) (${enabledCount} become store-visible) of ${scanned} scanned`

    return {
      job_id: repairShippingOptionStoreVisibilityJob.id,
      dry_run,
      applied: !dry_run && changes.length > 0 && errors.length < changes.length,
      summary,
      changes,
      errors: errors.length ? errors : undefined,
    }
  },
}
