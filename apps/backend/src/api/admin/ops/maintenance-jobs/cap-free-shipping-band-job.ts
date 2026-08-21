import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import {
  DOMESTIC_MANUAL_RATES,
  INTL_MANUAL_RATES,
} from "./backfill-partner-shipping-options-job"
import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

/**
 * Close the open end of free shipping (#1428 follow-up, founder call 21 Aug 2026).
 *
 * ## The bug this repairs
 *
 * Every partner store's manual flat shipping option carries a second price row
 * of 0 gated on `item_total >= freeAbove` — retail free shipping. There was no
 * upper bound.
 *
 * 🔴 A `gte` threshold cannot exclude bulk. A B2B consignment is LARGER than a
 * retail basket, so it clears the bar harder, not less. "Free over ₹2,999"
 * therefore applies to a ₹36,00,000 order, and the first live B2B quote duly
 * landed on freight 0.
 *
 * (#1430 fixed a *different* route to the same 0 — the quote estimate never
 * read `price_rules` at all. That made the QUOTE honest. It did nothing about
 * the CART, which reads the rules correctly and would still have shipped a bulk
 * order free. Both halves are needed; neither substitutes for the other.)
 *
 * ## Which ceiling, and how this job knows
 *
 * The ceiling is where RETAIL stops, not where bulk starts, so it comes from
 * the rate table in `backfill-partner-shipping-options-job.ts` — the same
 * source new stores are provisioned from. Domestic ₹25,000; international one
 * step higher, because cross-border pricing steps at 5 kg.
 *
 * 🔑 Domestic and international are told apart by the EXISTING `gte` value, not
 * by the option's name. INR appears in both tables (2999 domestic, 25000
 * international) and the thresholds are distinct, so the row identifies its own
 * lane. Names were hand-edited during #954 and cannot be trusted for this —
 * the same trap that made the Shiprocket backfill classify from geo zones.
 *
 * A threshold matching NEITHER table was set by hand. This job reports it and
 * moves on rather than imposing a ceiling nobody chose.
 *
 * Idempotent: a price that already has an `lte` is left alone.
 */

export const MAX_OPTION_SCAN = 2000

const paramsSchema = z.object({
  shipping_option_id: z.string().min(1).optional(),
  limit: z.number().int().positive().max(MAX_OPTION_SCAN).optional().default(MAX_OPTION_SCAN),
})

export type FreeShippingCapPlan = {
  price_id: string
  shipping_option_id: string
  shipping_option_name: string
  currency_code: string
  /** The threshold already on the row — what identified the lane. */
  free_above: number
  /** The ceiling to add. */
  free_up_to: number
  lane: "domestic" | "international"
}

export type FreeShippingCapSkip = {
  price_id: string
  shipping_option_name: string
  currency_code: string
  reason: string
}

/**
 * PURE: which 0-priced rows still have an open-ended free-shipping tail.
 *
 * Exported for unit tests — this is the whole decision, and it must be
 * inspectable without a database.
 */
export function planFreeShippingCaps(options: any[]): {
  plan: FreeShippingCapPlan[]
  skipped: FreeShippingCapSkip[]
} {
  const plan: FreeShippingCapPlan[] = []
  const skipped: FreeShippingCapSkip[] = []

  for (const option of options ?? []) {
    // Calculated options carry no flat price rows to bound.
    if (option?.price_type === "calculated") continue

    for (const price of option?.prices ?? []) {
      const rules = (price?.price_rules ?? []) as any[]
      const gte = rules.find(
        (r) => r?.attribute === "item_total" && r?.operator === "gte"
      )
      if (!gte) continue

      const name = option?.name ?? option?.id ?? "?"
      const currency = String(price?.currency_code ?? "").toLowerCase()

      // Already bounded — the whole point of being idempotent.
      if (rules.some((r) => r?.attribute === "item_total" && r?.operator === "lte")) {
        continue
      }

      const freeAbove = Number(gte.value)
      if (!Number.isFinite(freeAbove)) {
        skipped.push({
          price_id: price.id,
          shipping_option_name: name,
          currency_code: currency,
          reason: `Threshold "${gte.value}" is not a number.`,
        })
        continue
      }

      // 🔑 The lane comes from the threshold, never from the name.
      const domestic = DOMESTIC_MANUAL_RATES[currency]
      const intl = INTL_MANUAL_RATES[currency]
      let lane: "domestic" | "international" | null = null
      let freeUpTo = 0

      if (domestic && domestic.freeAbove === freeAbove) {
        lane = "domestic"
        freeUpTo = domestic.freeUpTo
      } else if (intl && intl.freeAbove === freeAbove) {
        lane = "international"
        freeUpTo = intl.freeUpTo
      }

      if (!lane) {
        skipped.push({
          price_id: price.id,
          shipping_option_name: name,
          currency_code: currency,
          reason: `Threshold ${freeAbove} ${currency} matches neither the domestic nor the international rate table — set by hand, so no ceiling is imposed.`,
        })
        continue
      }

      plan.push({
        price_id: price.id,
        shipping_option_id: option.id,
        shipping_option_name: name,
        currency_code: currency,
        free_above: freeAbove,
        free_up_to: freeUpTo,
        lane,
      })
    }
  }

  return { plan, skipped }
}

export const capFreeShippingBandJob: MaintenanceJob = {
  id: "cap-free-shipping-band",
  label: "Close the open end of free shipping (bulk orders were shipping free)",
  description:
    "Every partner store's manual flat shipping option has a 0-priced row gated on `item_total >= N` — retail free shipping with no upper bound. A `gte` cannot exclude bulk: a B2B consignment is LARGER than a retail basket, so it clears the bar harder, and the first live B2B quote (₹36,00,000, 21 kg) shipped free. This adds the matching `item_total <= ceiling` rule so free shipping applies to a BAND. Ceilings come from the same rate table new stores are provisioned from — ₹25,000 domestic, one step higher international because cross-border pricing steps at 5 kg. Domestic and international are told apart by the EXISTING threshold, not by the option name (names were hand-edited during #954). A threshold matching neither table was set by hand: it is reported and left alone. Idempotent — a price that already has an `lte` is skipped. Dry-run previews every ceiling it would add.",
  params: [
    {
      name: "shipping_option_id",
      type: "string",
      required: false,
      description: "Restrict to a single shipping option (default: every flat option)",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: `Max shipping options to scan in one call (default & max ${MAX_OPTION_SCAN})`,
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
    const { shipping_option_id, limit } = parsed.data

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const pricing: any = container.resolve(Modules.PRICING)

    const { data: options } = await query.graph({
      entity: "shipping_option",
      fields: [
        "id",
        "name",
        "price_type",
        "prices.id",
        "prices.amount",
        "prices.currency_code",
        // ⚠️ `prices.*` does NOT include this relation. Without it every row
        // arrives looking unconditional — the same blind spot that hid #1430.
        "prices.price_rules.*",
      ],
      ...(shipping_option_id ? { filters: { id: shipping_option_id } } : {}),
      pagination: { take: limit },
    })

    const { plan, skipped } = planFreeShippingCaps((options ?? []) as any[])

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []

    for (const item of plan) {
      changes.push({
        entity: "price_rule",
        id: item.price_id,
        field: `item_total ceiling (${item.lane}, ${item.shipping_option_name})`,
        before: `free at or above ${item.free_above} ${item.currency_code}, no upper bound`,
        after: `free between ${item.free_above} and ${item.free_up_to} ${item.currency_code}`,
      })

      if (dry_run) continue

      try {
        // ⚠️ `CreatePriceRuleDTO` omits `operator` in @medusajs/types, but the
        // model has it and the existing `gte` rows carry it. The types are
        // behind the model; the cast is deliberate, not laziness.
        await pricing.createPriceRules([
          {
            price_id: item.price_id,
            attribute: "item_total",
            operator: "lte",
            value: String(item.free_up_to),
          },
        ] as any)
      } catch (e: any) {
        errors.push({ id: item.price_id, message: e?.message ?? String(e) })
      }
    }

    const scanned = (options ?? []).length
    const summary = changes.length
      ? `${dry_run ? "Would cap" : "Capped"} ${changes.length} free-shipping tier(s) across ${scanned} scanned option(s); ${skipped.length} hand-set threshold(s) left alone.`
      : `No changes — scanned ${scanned} option(s); every free-shipping tier is already bounded. ${skipped.length} hand-set threshold(s) left alone.`

    return {
      job_id: capFreeShippingBandJob.id,
      dry_run,
      applied: !dry_run && changes.length > 0 && errors.length < changes.length,
      summary,
      changes,
      errors: errors.length
        ? errors
        : skipped.length
          ? skipped.map((s) => ({ id: s.price_id, message: s.reason }))
          : undefined,
    }
  },
}
