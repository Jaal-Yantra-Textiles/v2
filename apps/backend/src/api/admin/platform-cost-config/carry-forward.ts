import type { PlatformCostConfigRow } from "../../../modules/platform-cost-config/resolve-lib"

/** The economic columns a new policy carries forward from the one in force. */
export const COST_CONFIG_FIELDS = [
  "platform_fee_percent",
  "production_overhead_percent",
  "default_material_cost",
  "default_material_cost_currency",
  "custom_design_markup_percent",
  "approval_markup_multiplier",
] as const

export type CostConfigField = (typeof COST_CONFIG_FIELDS)[number]

/**
 * PURE: build the next policy's columns from a partial request and the policy
 * currently in force (#1939).
 *
 * 🔴 The distinction this exists to protect:
 *
 *   field ABSENT from the body  -> carry the current value forward
 *   field present as `null`     -> deliberately unset it
 *   field present with a value  -> use it
 *
 * Without the first rule, `{ custom_design_markup_percent: 25 }` would insert a
 * row with four nulls and silently switch off the platform fee, the production
 * overhead and the approval markup. With the second collapsed into the first,
 * there would be no way to ever unset a number once set.
 *
 * A key must be BOTH present and not `undefined` to count as given. Zod strips
 * omitted optional keys, so the route sees `{}` for them (probed, not assumed) —
 * but a JS caller spreading `{ ...patch, field: undefined }` produces a key that
 * `hasOwnProperty` reports as present while carrying no value, and writing that
 * `undefined` into the column would blank it. `undefined` therefore means absent
 * and only an explicit `null` unsets.
 *
 * Pure so the rule can be tested without a database, which is the only way to be
 * sure of it — the first version of this function got the `undefined` case wrong
 * and its own unit test is what caught it.
 */
export function buildNextConfig(
  body: Record<string, unknown>,
  current: PlatformCostConfigRow | null | undefined
): Record<CostConfigField, unknown> {
  const out = {} as Record<CostConfigField, unknown>
  for (const field of COST_CONFIG_FIELDS) {
    if (
      Object.prototype.hasOwnProperty.call(body, field) &&
      body[field] !== undefined
    ) {
      // Given — including an explicit null, which means "unset".
      out[field] = body[field]
    } else {
      // Absent — inherit, so a one-field change does not blank the rest.
      out[field] = current?.[field] ?? null
    }
  }
  return out
}
