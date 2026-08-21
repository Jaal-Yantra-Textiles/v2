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
  | "variant_not_in_catalogue"
  | "line_unpriced"
  | "weight_missing"
  | "no_freight_option"
  | "freight_currency_mismatch"
  | "tax_region_missing"

export type QuoteReadinessIssue = {
  code: QuoteReadinessCode
  severity: "blocking" | "warning"
  /** Written for the partner staring at the wizard, not for a log. */
  message: string
  variant_id?: string | null
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
  }
}

export type QuoteReadinessInput = {
  lines: Array<{ variant_id: string; quantity: number }>
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
        })),
        destination_postal_code: String(input.destination_postal_code ?? ""),
        country_code: input.destination_country_code,
        // Without this, manual options are compared across currencies and the
        // cheapest NUMBER wins regardless of unit (#1424/#1434).
        currency_code: input.currency_code,
        carrier: input.carrier,
        store: input.store as any,
      })

      const chosen = pickFreightOption(estimate)
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
