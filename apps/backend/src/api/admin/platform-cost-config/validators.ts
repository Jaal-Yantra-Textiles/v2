import { z } from "zod"

/**
 * Platform cost-config payloads (#1939).
 *
 * ## Why there is no PATCH
 *
 * The table is EFFECTIVE-DATED: a policy change is a new row, never an edit to
 * an old one, because a price already quoted must stay explicable under the
 * policy it was quoted under. So the only write is a POST that inserts the next
 * policy. Editing in place would silently rewrite the past.
 *
 * ## The carry-forward rule — the load-bearing part
 *
 * A caller who wants to move the markup to 25% sends ONLY
 * `custom_design_markup_percent`. If the other four columns then landed as null,
 * that request would silently switch OFF the platform fee, the overhead and the
 * approval markup — a one-field edit quietly unsetting the platform's economics.
 *
 * So an OMITTED field carries forward from the policy currently in force, and an
 * EXPLICIT `null` unsets it. Those are different requests and zod can tell them
 * apart: absent parses to `undefined`, `null` parses to `null`. Every field is
 * therefore `.nullable().optional()` — the two markers are not interchangeable
 * here, and collapsing them would destroy the distinction.
 */

/** A percentage: 0 is a real policy ("no commission"), so the floor is 0 not 1. */
const percent = z
  .number()
  .min(0, "a percentage cannot be negative")
  .max(1000, "a percentage above 1000 is almost certainly a typo")

export const CreatePlatformCostConfigSchema = z.object({
  /**
   * When this policy takes effect. Defaults to now. A FUTURE date stages the
   * policy without applying it — the resolver skips rows dated ahead of the
   * moment it is asked about.
   */
  effective_from: z
    .string()
    .min(1)
    .refine((v) => !Number.isNaN(new Date(v).getTime()), {
      message: "must be a valid date",
    })
    .optional(),

  /** Why the policy changed. Write the decision; the number is a column. */
  notes: z.string().trim().max(2000).nullable().optional(),

  platform_fee_percent: percent.nullable().optional(),
  production_overhead_percent: percent.nullable().optional(),

  /** Fallback per-unit material cost. Not a percentage — an amount. */
  default_material_cost: z
    .number()
    .min(0, "a cost cannot be negative")
    .nullable()
    .optional(),
  default_material_cost_currency: z
    .string()
    .trim()
    .length(3, "a currency code is 3 letters, e.g. INR")
    .nullable()
    .optional(),

  custom_design_markup_percent: percent.nullable().optional(),

  /**
   * A MULTIPLIER, not a percentage: 1.4 lists at 140% of cost. Floored at 1
   * because a multiplier below 1 lists BELOW cost, which is a loss on every
   * unit and is far more likely a percentage typed into the wrong field.
   */
  approval_markup_multiplier: z
    .number()
    .min(1, "a multiplier below 1 would list below cost — did you mean a percent?")
    // 🔴 Ceiling of 10, not 100. The realistic range is 1.0–2.0 (1.4 today), and
    // 10x cost is already a 90% margin. A loose ceiling here does not catch the
    // one mistake this field actually invites: typing the PERCENT (20, 25, 40)
    // into the MULTIPLIER. A probe caught `40` sailing through a max of 100 and
    // listing at 4000% of cost.
    .max(
      10,
      "a multiplier above 10 is almost certainly a percentage — 1.4 means 140% of cost, 40 would mean 4000%"
    )
    .nullable()
    .optional(),
})

export type CreatePlatformCostConfig = z.infer<
  typeof CreatePlatformCostConfigSchema
>
