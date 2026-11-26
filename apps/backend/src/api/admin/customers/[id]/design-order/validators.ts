import { z } from "zod"

/**
 * #2645 — a deposit given AT creation, so the first PayU link and the first
 * email are for the deposit, not the total. Same rules as
 * `POST /admin/designs/orders/:lineItemId/deposit` (`decideDeposit`, which
 * re-checks everything against the real cart total); this only rejects what
 * can be rejected before a cart exists.
 */
const DepositFields = {
  deposit_pct: z.number().gt(0).lt(100).optional(),
  deposit_amount: z.number().gt(0).optional(),
  balance_trigger: z.enum(["manual", "dispatch"]).optional(),
}

const refineDeposit = (
  v: { deposit_pct?: number; deposit_amount?: number; balance_trigger?: string },
  ctx: z.RefinementCtx
) => {
  if (v.deposit_pct !== undefined && v.deposit_amount !== undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["deposit_amount"],
      message: "Give deposit_pct OR deposit_amount, not both.",
    })
  }
  if (
    v.balance_trigger !== undefined &&
    v.deposit_pct === undefined &&
    v.deposit_amount === undefined
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["balance_trigger"],
      message: "balance_trigger needs a deposit_pct or deposit_amount.",
    })
  }
}

const CreateDesignOrderBase = z.object({
  design_ids: z.array(z.string()).min(1),
  currency_code: z.string().length(3).optional(),
  price_overrides: z.record(z.string(), z.number().min(0)).optional(),
  override_currency: z.string().length(3).optional(),
  /**
   * 🔴 Where the buyer is buying FROM, as ISO-2. Optional, and the reason it
   * exists is that a cart without it is not merely incomplete — it is broken.
   *
   * An admin design order collects no address, so the cart named no country
   * and the checkout link could not be built. Writing one by hand does not
   * help: observed in prod on 2026-09-19, `/se/checkout/cart/<id>` AND
   * `/de/checkout/cart/<id>` both redirected to `/al/` — Albania — because the
   * storefront re-resolves the region and takes `countries[0]`.
   *
   * It also un-breaks shipping. `/store/shipping-options?cart_id=` cannot
   * geo-filter a cart with no country, so a Swedish buyer was offered Delhivery
   * and a Dharamshala pickup.
   *
   * Lower-cased here so "SE" and "se" cannot become two different carts.
   */
  country_code: z
    .string()
    .trim()
    .length(2)
    .transform((v) => v.toLowerCase())
    .optional(),
  ...DepositFields,
})

export const CreateDesignOrderSchema = CreateDesignOrderBase.superRefine(refineDeposit)

/**
 * The customer-less twin (#1817). Same body, plus an OPTIONAL customer —
 * `/admin/designs/draft-order` has no id in its path, so if a buyer is known
 * it travels in the body instead.
 */
export const CreateDesignDraftOrderSchema = CreateDesignOrderBase.extend({
  customer_id: z.string().min(1).nullish(),
}).superRefine(refineDeposit)
