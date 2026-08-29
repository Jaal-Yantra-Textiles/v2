import { ContainerRegistrationKeys, QueryContext } from "@medusajs/framework/utils"

import {
  buildShippingEstimate,
  resolveUnitWeight,
} from "../../../lib/shipping-estimate"
import { pickFreightOption } from "./build-quote-view"

/**
 * Can this basket actually be quoted? (#1445 / #1439 S6)
 *
 * ## Why this exists
 *
 * Every wrong number this feature has produced was minted **successfully**.
 * #1416 priced nothing. #1424 quoted a Mumbai consignment as "European
 * Shipping" at 10 AUD. #1430 shipped every bulk order free. #1433 offered
 * another tenant's pickup option. #1434 added a rupee rate into a euro total.
 * In each case the mint returned 201 and the partner had no way to know.
 *
 * The system had no way to say *"I don't know"*, so it said something
 * confident and false. This says it instead.
 *
 * ## Why it collects instead of throwing
 *
 * `buildQuoteView` throws on the FIRST problem, which is right for a render
 * path and wrong for a preflight: a partner fixing a quote one error at a time
 * plays whack-a-mole across five round trips. Every check here runs and every
 * failure is named, so one pass shows the whole picture.
 *
 * 🔑 Weights are checked BEFORE the shipping estimate is called, deliberately.
 * `buildShippingEstimate` refuses the whole basket on the first weightless
 * line — correctly, since a landed total missing one line's freight is a wrong
 * number wearing a confident label — but it cannot tell you *which* variants
 * to fix. Checking first is what turns "this basket cannot ship" into "these
 * two variants have no weight".
 *
 * ## What a failure means
 *
 * `blocking` means the mint would produce a number nobody should act on.
 * `warning` means the quote is mintable but something downstream is missing —
 * a tax region, today, because tax is not on the quote yet (#1447). Warnings
 * must never be promoted to blocking silently: refusing to quote for a
 * capability we have not shipped would be worse than the gap.
 */

export type QuoteReadinessCode =
  | "store_location_missing"
  | "store_sales_channel_missing"
  | "variant_missing"
  /** A line named a design that cannot be resolved to one variant (#1486). */
  | "design_unresolved"
  | "variant_not_in_catalogue"
  | "line_unpriced"
  | "weight_missing"
  | "no_freight_option"
  /**
   * The carrier could not rate this lane and nobody typed a rate, so the only
   * number available is a store-configured flat tier that does not vary with
   * weight (#1439 S12 tail).
   */
  | "freight_needs_manual_rate"
  | "freight_currency_mismatch"
  | "tax_region_missing"

/**
 * PURE: is the only available freight figure a flat tier standing in for a rate
 * nobody could get?
 *
 * Extracted so it can be tested at all. The branch it guards needs a carrier
 * that fails AND a store with a manual option configured, which no fixture
 * reproduces — so left inline it would be behaviour with no coverage, on a
 * path whose entire history is plausible numbers shipping unnoticed.
 *
 * A typed override answers the question outright: someone looked up the real
 * rate, so there is nothing to refuse.
 *
 * ## 🔴 Why this asks "did a carrier rate it?" and not "did a carrier error?"
 *
 * It used to be `Boolean(calculatedError) && override === null` — it fired only
 * when the carrier *raised* something. A carrier that returns an EMPTY LIST
 * without erroring leaves `calculated_error` null, so the guard stayed silent,
 * readiness answered `ready: true`, and the quote went out on the flat tier
 * (#1528).
 *
 * That happened, on a real customer quote to Amsterdam: `ready=true`,
 * `blocking=0`, `error=null`, freight €35 flat — hours after the same lane had
 * returned seven carrier options with the cheapest at €36.42. I read the
 * guard's silence as evidence the carrier had rated the lane and told the
 * founder so. It was absence in my instrument, not in the world.
 *
 * The bitter part is that this guard's own docblock says it exists because
 * *"the number is never absent, so nothing looks broken"* — and it reproduced
 * that failure through itself. So the question it asks is now the one that
 * actually matters: **is the figure we are about to freeze one a carrier
 * gave us?** An error, an empty answer and a timeout are all the same thing to
 * a buyer.
 *
 * Three states, not two:
 *
 * | carrier | verdict |
 * |---|---|
 * | not asked (`carrier: "manual"`/`"none"`) | fine — pricing by hand is the plan |
 * | asked, errored | refuse |
 * | asked, returned nothing | refuse |
 * | asked, rated, and a rated option won | fine |
 *
 * 🔑 `carrierConsulted` is the load-bearing input. Without it an empty
 * `calculated` list cannot be told apart from a deliberate decision to ask
 * nobody, and refusing THAT would block every hand-priced lane the store has
 * configured on purpose.
 */
export function needsManualFreightRate(input: {
  /** Whatever the carrier raised, if it raised anything. */
  calculatedError: string | null | undefined
  /**
   * Was a carrier asked at all? `ShippingEstimate.carrier_consulted`. False
   * means "manual" was chosen deliberately and there is nothing to report.
   */
  carrierConsulted: boolean
  /**
   * Where the figure about to be frozen came from. `"calculated"` is a real
   * carrier rate; `"manual"` is a store-configured flat tier that does not
   * move with weight.
   */
  chosenSource: "manual" | "calculated" | null | undefined
  /** A rate someone looked up and typed. Zero IS an answer. */
  override: number | null
}): boolean {
  if (input.override !== null) return false
  // Nobody was asked. The flat tier is the intended answer, not a stand-in.
  if (!input.carrierConsulted) return false
  // A carrier rate won: whatever else went wrong, the number is a real quote
  // for this lane at this weight.
  if (input.chosenSource === "calculated") return false
  return true
}

export type QuoteReadinessIssue = {
  code: QuoteReadinessCode
  severity: "blocking" | "warning"
  /** Written for the partner staring at the wizard, not for a log. */
  message: string
  variant_id?: string | null
  /** Set on `design_unresolved`, so the wizard can highlight the right row. */
  design_id?: string | null
  data?: Record<string, unknown>
}

export type QuoteReadinessResult = {
  ready: boolean
  issues: QuoteReadinessIssue[]
  blocking_count: number
  warning_count: number
  /** What the preflight actually resolved, so the wizard can preview it. */
  freight: {
    chosen: { name: string | null; amount: number; currency_code: string } | null
    total_weight_grams: number | null
    error: string | null
    /**
     * Whether a carrier was asked, and how many rates came back (#1528).
     *
     * 🔑 `error: null` was never enough to conclude the lane had been rated —
     * a carrier can answer nothing without failing. The count is reported so
     * the operator reads a fact rather than inferring one from a silence, the
     * way I did.
     */
    carrier_consulted: boolean
    carrier_rated_count: number
  }
}

export type QuoteReadinessInput = {
  /**
   * `unit_weight_grams` is the operator's own figure for a line the catalogue
   * cannot weigh — a design-led quote, or one of the 183 variants carrying no
   * weight at either level. Priced with, never persisted.
   */
  lines: Array<{
    variant_id: string
    quantity: number
    unit_weight_grams?: number | null
  }>
  store: {
    id?: string | null
    default_location_id?: string | null
    default_sales_channel_id?: string | null
  }
  destination_country_code: string
  destination_postal_code?: string | null
  currency_code: string
  region_id?: string | null
  carrier?: string
  /** How the partner is named back to the user in a catalogue mismatch. */
  partner_label?: string
  /**
   * Whether catalogue ownership is checked. The partner surface is naturally
   * scoped — a partner picks from their own catalogue — while an admin picks a
   * partner from one dropdown and variants from another, and a single mis-click
   * freezes one partner's prices onto another's customer group.
   */
  check_catalogue?: boolean
  /**
   * Freight the partner is naming by hand, in the quote currency (#1439 S12).
   *
   * Present ⇒ the lane no longer has to be rateable for the quote to be ready.
   * Mirrors `buildQuoteView`; if the two ever disagree, the preflight would
   * pass a body the mint rejects, which is worse than having no preflight.
   */
  freight_override_amount?: number | null
}

export async function assessQuoteReadiness(
  scope: any,
  input: QuoteReadinessInput
): Promise<QuoteReadinessResult> {
  const query: any = scope.resolve(ContainerRegistrationKeys.QUERY)
  const issues: QuoteReadinessIssue[] = []

  const lines = (input.lines ?? []).filter(
    (l) => l?.variant_id && Number(l.quantity) > 0
  )
  const variantIds = Array.from(new Set(lines.map((l) => l.variant_id)))

  // ---- The store can originate a shipment at all -------------------------
  if (!input.store?.default_location_id) {
    // `buildShippingEstimate` filters its location reads on this. Passing it
    // undefined does not read "no locations" — `filters: { id: undefined }` is
    // NO FILTER, which is how a public quote page once offered another
    // tenant's "In Person Pickup" for a Mumbai delivery (#1433).
    issues.push({
      code: "store_location_missing",
      severity: "blocking",
      message:
        "This store has no default stock location, so there is nowhere to ship from and freight cannot be quoted.",
    })
  }

  if (input.check_catalogue && !input.store?.default_sales_channel_id) {
    issues.push({
      code: "store_sales_channel_missing",
      severity: "blocking",
      message: `${input.partner_label || "This partner"} has no default sales channel, so it cannot be verified that these variants belong to them.`,
    })
  }

  // ---- The variants exist, belong here, and have a weight -----------------
  const { data: variants = [] } = await query.graph({
    entity: "variant",
    fields: [
      "id",
      "title",
      "weight",
      "product.id",
      "product.title",
      "product.weight",
      "product.sales_channels.id",
    ],
    filters: { id: variantIds },
  })

  const byId = new Map<string, any>((variants ?? []).map((v: any) => [v.id, v]))

  for (const id of variantIds) {
    const variant = byId.get(id)

    if (!variant) {
      issues.push({
        code: "variant_missing",
        severity: "blocking",
        message: `Variant ${id} no longer exists, so it cannot be quoted.`,
        variant_id: id,
      })
      continue
    }

    const label = variant.title
      ? `${variant.product?.title ?? ""} ${variant.title}`.trim()
      : id

    if (input.check_catalogue && input.store?.default_sales_channel_id) {
      const channels = (variant.product?.sales_channels ?? []) as any[]
      if (
        !channels.some((c) => c?.id === input.store.default_sales_channel_id)
      ) {
        issues.push({
          code: "variant_not_in_catalogue",
          severity: "blocking",
          message: `"${label}" is not in ${input.partner_label || "this partner"}'s catalogue, so it cannot be quoted for them.`,
          variant_id: id,
        })
      }
    }

    if (!resolveUnitWeight(variant)) {
      // 140 of 183 variants are null at BOTH levels. Without a weight the
      // freight leg is a guess, and a guessed landed total is the number a
      // buyer commits to.
      issues.push({
        code: "weight_missing",
        severity: "blocking",
        message: `"${label}" has no weight on the variant or its product, so freight for it would be a guess.`,
        variant_id: id,
      })
    }
  }

  // ---- Every line prices AT ITS OWN QUANTITY ------------------------------
  for (const line of lines) {
    if (!byId.has(line.variant_id)) continue

    let unitAmount = NaN
    try {
      const { data: priced } = await query.graph({
        entity: "variant",
        fields: ["id", "calculated_price.*"],
        filters: { id: line.variant_id },
        context: {
          calculated_price: QueryContext({
            ...(input.region_id ? { region_id: input.region_id } : {}),
            currency_code: input.currency_code,
            // 🔴 The quantity IS the point: without it the pricing module
            // answers with the qty-1 tier, and a "price at 500" rendered from a
            // product payload is silently the price at 1.
            quantity: line.quantity,
          }),
        },
      })
      unitAmount = Number(
        (priced?.[0] as any)?.calculated_price?.calculated_amount
      )
    } catch {
      unitAmount = NaN
    }

    if (!Number.isFinite(unitAmount)) {
      // `planQuotePrices` DROPS a line with no amount rather than zeroing it —
      // correct, but silent. A quote could mint showing more lines than it
      // actually priced. This is where that becomes visible.
      const label = byId.get(line.variant_id)?.title || line.variant_id
      issues.push({
        code: "line_unpriced",
        severity: "blocking",
        message: `"${label}" has no price in ${input.currency_code.toUpperCase()} at quantity ${line.quantity}, so it would be dropped from the quote.`,
        variant_id: line.variant_id,
        data: { quantity: line.quantity, currency_code: input.currency_code },
      })
    }
  }

  // ---- Freight actually resolves for this lane ---------------------------
  let freight: QuoteReadinessResult["freight"] = {
    chosen: null,
    total_weight_grams: null,
    error: null,
    carrier_consulted: false,
    carrier_rated_count: 0,
  }

  const canEstimate =
    !issues.some(
      (i) =>
        i.severity === "blocking" &&
        (i.code === "weight_missing" ||
          i.code === "variant_missing" ||
          i.code === "store_location_missing")
    ) && lines.length > 0

  if (canEstimate) {
    try {
      const estimate = await buildShippingEstimate(scope, {
        lines: lines.map((l) => ({
          variant_id: l.variant_id,
          quantity: l.quantity,
          unit_weight_grams: l.unit_weight_grams ?? null,
        })),
        destination_postal_code: String(input.destination_postal_code ?? ""),
        country_code: input.destination_country_code,
        // Without this, manual options are compared across currencies and the
        // cheapest NUMBER wins regardless of unit (#1424/#1434).
        currency_code: input.currency_code,
        carrier: input.carrier,
        store: input.store as any,
      })

      const rated = pickFreightOption(estimate)
      // How many REAL carrier rates came back. The only honest basis for
      // saying the carrier returned nothing — see the message below.
      const ratedCount = (estimate.calculated ?? []).length

      /**
       * Freight the partner named by hand (#1439 S12).
       *
       * 🔑 The preflight has to agree with the mint or it is worse than
       * useless — it would tell a partner their quote is not ready and then the
       * mint would accept it, or the reverse. `buildQuoteView` lets an override
       * stand in for a picked option, so this must too.
       *
       * It is also what makes today's cross-border lanes assessable at all: the
       * carrier answers "no serviceable couriers available for given weight",
       * so `rated` is frequently null on exactly the quotes we most want to
       * send.
       */
      const override =
        input.freight_override_amount === null ||
        input.freight_override_amount === undefined ||
        !Number.isFinite(Number(input.freight_override_amount))
          ? null
          : Number(input.freight_override_amount)

      const chosen = override !== null
        ? {
            name: "Freight (quoted by hand)",
            amount: override,
            // By construction, not by luck: an override is stated in the quote
            // currency, so the mismatch check below cannot fire on it.
            currency_code: input.currency_code,
          }
        : rated

      freight = {
        chosen: chosen
          ? {
              name: chosen.name ?? null,
              amount: chosen.amount,
              currency_code: chosen.currency_code,
            }
          : null,
        total_weight_grams: estimate.total_weight_grams,
        error: estimate.calculated_error,
        carrier_consulted: estimate.carrier_consulted,
        carrier_rated_count: ratedCount,
      }

      if (!chosen) {
        issues.push({
          code: "no_freight_option",
          severity: "blocking",
          message: estimate.calculated_error
            ? `No freight option could be quoted to ${input.destination_country_code.toUpperCase()}: ${estimate.calculated_error}`
            : `No freight option could be quoted to ${input.destination_country_code.toUpperCase()} from this store's location.`,
          data: { country_code: input.destination_country_code },
        })
      } else if (
        needsManualFreightRate({
          calculatedError: estimate.calculated_error,
          carrierConsulted: estimate.carrier_consulted,
          // The override branch above builds `chosen` by hand with no source,
          // but it also sets `override`, which short-circuits first.
          chosenSource: (chosen as any)?.source ?? null,
          override,
        })
      ) {
        /**
         * 🔴 A FLAT TIER IS NOT A RATE FOR A LANE NOBODY COULD RATE.
         *
         * When the carrier refuses — and on cross-border it refuses constantly,
         * with "No serviceable couriers available for given weight" — the
         * picker falls through to whatever manual shipping option the store has
         * configured. On prod that is a flat 35 EUR, and it is 35 EUR at 3 kg
         * and 35 EUR at 22 kg. Readiness answered `ready: true` and the quote
         * went out with it.
         *
         * That is the shape this epic has already shipped three times: a
         * plausible number standing in for an unknown one (#1424 zone-blind,
         * #1430 rule-blind, #1485 the return option). The number is never
         * absent, so nothing looks broken.
         *
         * So: refuse, and name the remedy. S12 exists precisely for this —
         * `freight_override_amount` lets a partner read the real DHL/carrier
         * rate and type it, badged "By hand" and recorded with its basis. This
         * makes an unrateable lane sendable ON PURPOSE rather than by accident,
         * and it is the only thing standing between a buyer and a freight
         * figure nobody chose.
         */
        issues.push({
          code: "freight_needs_manual_rate",
          severity: "blocking",
          /**
           * 🔴 "Returned nothing" means NO RATES, not "no error".
           *
           * The first cut of this derived it from `!calculated_error`, so a
           * carrier that rated the lane perfectly well was described as having
           * "returned no rates at all" — in a payload that carried
           * `carrier_rated_count: 1` two fields later. A message that
           * contradicts its own data is worse than no message: it sends the
           * operator to look for a carrier outage that never happened.
           *
           * Found by probing prod, not by reading this file.
           */
          message:
            `Freight to ${input.destination_country_code.toUpperCase()} could not be priced from a carrier ` +
            (estimate.calculated_error
              ? `(${estimate.calculated_error})`
              : `(the carrier was asked and returned no rates at all — no error either)`) +
            `, so the only figure available is a flat rate that does ` +
            `not change with weight. Look up the real rate (DHL and the like) and type it in — ` +
            `it will be shown to the buyer as quoted by hand.`,
          data: {
            country_code: input.destination_country_code,
            fallback_amount: chosen.amount,
            fallback_name: chosen.name ?? null,
            carrier_rated_count: ratedCount,
            carrier_returned_nothing: ratedCount === 0,
          },
        })
      } else if (
        String(chosen.currency_code).toLowerCase() !==
        String(input.currency_code).toLowerCase()
      ) {
        // Should be impossible now the estimate is currency-filtered, but this
        // is the exact defect that shipped twice (#1424, #1434) — a rate in one
        // currency added straight into a total in another. Assert it at the
        // boundary rather than trusting the layer below.
        issues.push({
          code: "freight_currency_mismatch",
          severity: "blocking",
          message: `The freight option resolved in ${chosen.currency_code.toUpperCase()} but this quote is in ${input.currency_code.toUpperCase()}.`,
          data: {
            freight_currency: chosen.currency_code,
            quote_currency: input.currency_code,
          },
        })
      }
    } catch (e: any) {
      issues.push({
        code: "no_freight_option",
        severity: "blocking",
        message: `Freight could not be quoted for this lane: ${e?.message ?? String(e)}`,
      })
    }
  }

  // ---- Tax (warning until #1447 puts tax on the quote) --------------------
  try {
    const { data: taxRegions = [] } = await query.graph({
      entity: "tax_region",
      fields: ["id", "country_code"],
      filters: { country_code: input.destination_country_code.toLowerCase() },
    })
    if (!taxRegions?.length) {
      issues.push({
        code: "tax_region_missing",
        severity: "warning",
        message: `No tax region is configured for ${input.destination_country_code.toUpperCase()}, so tax cannot be shown on this quote.`,
        data: { country_code: input.destination_country_code },
      })
    }
  } catch {
    // A tax lookup failing must not block a mint today — tax is not on the
    // quote yet. Silence here is the correct scope, not an oversight.
  }

  const blocking = issues.filter((i) => i.severity === "blocking")

  return {
    ready: blocking.length === 0,
    issues,
    blocking_count: blocking.length,
    warning_count: issues.length - blocking.length,
    freight,
  }
}
