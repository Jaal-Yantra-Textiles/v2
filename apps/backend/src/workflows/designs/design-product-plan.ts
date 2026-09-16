/**
 * One typed, validated description of "mint a product from this design".
 *
 * ## Why this exists
 *
 * Three doors mint a product from a design — the admin approve route, the bulk
 * run-output approval, and the quote path's `ensure-design-quote-variant` —
 * and each assembled its own object literal for `createProductFromDesignWorkflow`.
 * Nothing held them to the same shape, for a concrete reason:
 * `CreateProductFromDesignInput` was **not exported**, so the quote door cast
 * its input `as any` and type-checked nothing at all. A renamed or misspelt
 * field there would have compiled, minted, and quietly dropped the value.
 *
 * So the plan is the contract, and `applyDesignProductPlan` is the only door
 * through it.
 *
 * ## Two traps the schema closes
 *
 * 🔴 **`currency_code` is REQUIRED here.** The minter still falls back to
 * `input.currency_code || "usd"` internally, on a platform that trades in INR
 * and AUD — the exact fallback that listed every approved design in a currency
 * nobody sells in (#1805), and whose sibling (a EUR store default) minted INR
 * costs at ~110x (#1979). Every caller already passes one; requiring it makes
 * that `"usd"` unreachable through this door instead of merely unused.
 *
 * 🔴 **A non-positive price is refused, not listed.** `resolveListedPrice`
 * returns `0` for anything not finite and positive, and a price of 0 is a
 * claim — #1900 caught one on the storefront. All three doors already refuse
 * before calling (the approve route guards `estimated_cost > 0`, the quote
 * door returns `mintable: false` on a null unit price, and the bulk approval
 * throws "approving would list it at 0"). This codifies what all three do, so
 * a fourth door cannot forget it.
 *
 * Neither is a behaviour change for any caller that exists today.
 */
import { z } from "zod"

import {
  createProductFromDesignWorkflow,
  type CreateProductFromDesignInput,
  type CreateProductFromDesignOutput,
} from "./create-product-from-design"

export const designProductPlanSchema = z
  .object({
    design_id: z.string().min(1, "design_id is required"),

    /**
     * Legacy, and still the price when `unit_price` is absent — see
     * `resolveListedPrice`. Kept non-negative rather than positive because the
     * quote door passes 0 here deliberately and prices via `unit_price`.
     */
    estimated_cost: z
      .number()
      .finite("estimated_cost must be a finite number")
      .nonnegative("estimated_cost cannot be negative"),

    /** Overrides `estimated_cost`. Major units, already in `currency_code`. */
    unit_price: z
      .number()
      .finite("unit_price must be a finite number")
      .nonnegative("unit_price cannot be negative")
      .nullish(),

    /** Required — see the docblock. Normalised, because the minter lowercases. */
    currency_code: z
      .string()
      .trim()
      .min(3, "currency_code is required — there is no safe default")
      .max(3, "currency_code must be a 3-letter code")
      .transform((c) => c.toLowerCase()),

    /** Provenance on the design↔variant link. Absent when nobody has bought it. */
    customer_id: z.string().min(1).optional(),

    /** Produced after it is bought: published + `manage_inventory: false`. */
    made_to_order: z.boolean().optional(),

    /**
     * Whose catalogue. `null` means "let the minter route it" (partner-owned
     * designs to their partner, everything else to the house store) — which is
     * NOT the same as `stores[0]`, the row-0 lottery #2059 removed.
     */
    sales_channel_id: z.string().min(1).nullish(),

    /**
     * The size THIS mint is for, when the caller knows better than the design.
     *
     * A blank string is not an answer: `""` reaching the minter mints
     * `CUSTOM-<id>-` with a trailing separator and no size, which reads like a
     * real SKU. Normalised with a transform rather than `z.preprocess` — the
     * latter types its INPUT as `unknown` and required, which would force
     * every caller to pass a size they may not know.
     */
    size_label: z
      .string()
      .nullish()
      .transform((v) => (typeof v === "string" && v.trim() === "" ? undefined : v)),
  })
  .superRefine((plan, ctx) => {
    // Mirrors `resolveListedPrice`: unit_price wins when present, else the estimate.
    const listed = plan.unit_price != null ? plan.unit_price : plan.estimated_cost
    if (!(listed > 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["unit_price"],
        message:
          `Cannot mint design ${plan.design_id} at ${listed} ${plan.currency_code}: ` +
          `a price of 0 is a claim, not a price. Set unit_price, or give the ` +
          `design an estimated_cost.`,
      })
    }
  })

export type DesignProductPlan = z.input<typeof designProductPlanSchema>
export type ValidatedDesignProductPlan = z.output<typeof designProductPlanSchema>

/**
 * PURE: validate a plan, or explain exactly why it cannot be minted.
 *
 * Separate from `applyDesignProductPlan` so a caller can ask "would this mint?"
 * without a container — the quote path's readiness preflight is exactly that
 * question, and it must not need to attempt the write to answer it.
 */
export function parseDesignProductPlan(
  plan: DesignProductPlan
):
  | { ok: true; plan: ValidatedDesignProductPlan }
  | { ok: false; reason: string } {
  const parsed = designProductPlanSchema.safeParse(plan)
  if (parsed.success) return { ok: true, plan: parsed.data }

  return {
    ok: false,
    reason: parsed.error.issues
      .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
      .join("; "),
  }
}

/**
 * The single door. Validates, then mints.
 *
 * Throws on an invalid plan rather than minting something approximate — every
 * caller already refuses these cases before reaching here, so a throw means a
 * new caller skipped a check, not that an operator did something ordinary.
 */
export async function applyDesignProductPlan(
  container: any,
  plan: DesignProductPlan
): Promise<CreateProductFromDesignOutput> {
  const parsed = parseDesignProductPlan(plan)
  if (!parsed.ok) {
    throw new Error(`Invalid design product plan — ${parsed.reason}`)
  }

  const { result } = await createProductFromDesignWorkflow(container).run({
    input: parsed.plan satisfies CreateProductFromDesignInput,
  })

  return result as CreateProductFromDesignOutput
}

/**
 * The same door, in the shape `workflow.run()` returns.
 *
 * The admin approve route handles a mint failure itself — it logs the errors
 * and answers 500 with them, rather than letting an exception become an
 * unexplained stack. An invalid PLAN is reported the same way, so a caller
 * that already has an error path does not gain a second, throwing one.
 */
export async function applyDesignProductPlanResult(
  container: any,
  plan: DesignProductPlan
): Promise<{
  result?: CreateProductFromDesignOutput
  errors?: Array<{ error: string }>
}> {
  const parsed = parseDesignProductPlan(plan)
  if (!parsed.ok) {
    return { errors: [{ error: `Invalid design product plan — ${parsed.reason}` }] }
  }

  const { result, errors } = await createProductFromDesignWorkflow(container).run({
    input: parsed.plan satisfies CreateProductFromDesignInput,
  })

  return { result: result as CreateProductFromDesignOutput, errors: errors as any }
}
