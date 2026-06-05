/**
 * Seed the JYT-managed product_type + the IN tax_region dual-rate
 * setup needed to honour India's apparel/textile GST price-band rule
 * (5% ≤ ₹2,500/piece, 18% above). See `apps/docs/notes/TAX_NOTES.md`
 * for context.
 *
 * Two writes, both idempotent:
 *
 *   1. product_type with value=`jyt_tax_in_textile_over_2500`. The
 *      `classify-product-tax-class` workflow assigns this type to any
 *      product whose max INR variant price is ≥ ₹2,500.
 *
 *   2. On the IN tax_region (or, if no IN tax_region exists yet,
 *      create one via createTaxRegionsWorkflow first): ensure a
 *      non-default tax_rate at 18% with `rules: [{reference:
 *      "product_type", reference_id: <ptyp_id>}]`. The matcher then
 *      picks 18% over the default 5% for any line whose product is
 *      tagged.
 *
 * Run:
 *   npx medusa exec ./src/scripts/seed-in-textile-tax-class.ts
 *
 * Dry run (logs intent only):
 *   DRY_RUN=1 npx medusa exec ./src/scripts/seed-in-textile-tax-class.ts
 */

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  createProductTypesWorkflow,
  createTaxRegionsWorkflow,
} from "@medusajs/medusa/core-flows"
import { TAX_CLASS_OVER_2500_VALUE } from "../workflows/tax/classify-product-tax-class"

const OVER_2500_RATE_NAME = "India apparel/textile GST (>₹2,500)"
const OVER_2500_RATE_CODE = "IN-GST-OVER-2500"
const OVER_2500_RATE_PERCENT = 18

const DEFAULT_RATE_PERCENT = 5

export default async function seedInTextileTaxClass({
  container,
  args,
}: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const taxService: any = container.resolve(Modules.TAX)

  const dryRun =
    (args ?? []).includes("--dry-run") || process.env.DRY_RUN === "1"
  if (dryRun) {
    logger.info("DRY RUN — no rows will be created or modified.")
  }

  // 1. product_type — upsert by `value`.
  const { data: existingTypes } = await query.graph({
    entity: "product_type",
    filters: { value: TAX_CLASS_OVER_2500_VALUE },
    fields: ["id", "value"],
  })
  let overTypeId: string | null = (existingTypes ?? [])[0]?.id ?? null

  if (!overTypeId) {
    if (dryRun) {
      logger.info(
        `WOULD create product_type value="${TAX_CLASS_OVER_2500_VALUE}"`
      )
    } else {
      const { result } = await createProductTypesWorkflow(container).run({
        input: {
          product_types: [
            {
              value: TAX_CLASS_OVER_2500_VALUE,
              metadata: {
                jyt_managed: true,
                purpose:
                  "Tax classifier — assigned to products whose max INR variant price ≥ ₹2,500 so India tax_region's 18% rate fires.",
              },
            },
          ],
        },
      })
      overTypeId = (result?.[0] as any)?.id ?? null
      logger.info(
        `Created product_type ${overTypeId} (${TAX_CLASS_OVER_2500_VALUE})`
      )
    }
  } else {
    logger.info(
      `product_type already exists: ${overTypeId} (${TAX_CLASS_OVER_2500_VALUE})`
    )
  }

  // 2. IN tax_region — find or create the root (parent_id null) row.
  const { data: regions } = await query.graph({
    entity: "tax_regions",
    filters: { country_code: "in" },
    fields: ["id", "country_code", "parent_id"],
  })
  let inRegion = (regions ?? []).find((r: any) => !r.parent_id) as any | undefined

  if (!inRegion) {
    if (dryRun) {
      logger.info(
        `WOULD create canonical IN tax_region with default ${DEFAULT_RATE_PERCENT}% rate`
      )
    } else {
      const { result } = await createTaxRegionsWorkflow(container).run({
        input: [
          {
            country_code: "in",
            provider_id: "tp_system",
            default_tax_rate: {
              rate: DEFAULT_RATE_PERCENT,
              code: "IN-GST",
              name: "India GST (default — ≤₹2,500/piece)",
            },
          },
        ],
      })
      inRegion = Array.isArray(result) ? result[0] : result
      logger.info(`Created IN tax_region ${inRegion.id}`)
    }
  } else {
    logger.info(`IN tax_region exists: ${inRegion.id}`)
  }

  if (dryRun) {
    logger.info(
      `WOULD ensure non-default ${OVER_2500_RATE_PERCENT}% tax_rate on IN region with rule on product_type`
    )
    return
  }

  if (!overTypeId || !inRegion) {
    logger.warn(
      "Cannot finalise rate rule: missing product_type or tax_region. Re-run after the seed completes."
    )
    return
  }

  // 3. Non-default 18% tax_rate scoped to the product_type. Idempotent
  //    on the (region_id, code) pair.
  const { data: existingRates } = await query.graph({
    entity: "tax_rate",
    filters: { tax_region_id: inRegion.id, code: OVER_2500_RATE_CODE },
    fields: ["id", "rate", "code", "rules.reference", "rules.reference_id"],
  })
  const existingRate = (existingRates ?? [])[0] as any

  if (existingRate) {
    const ruleAlreadyBound = (existingRate.rules ?? []).some(
      (r: any) => r.reference === "product_type" && r.reference_id === overTypeId
    )
    if (ruleAlreadyBound && Number(existingRate.rate) === OVER_2500_RATE_PERCENT) {
      logger.info(
        `tax_rate ${existingRate.id} (${OVER_2500_RATE_CODE}, ${existingRate.rate}%) already wired — no change`
      )
      return
    }
    // Rate exists but the rule isn't bound (or rate drifted). Update.
    await taxService.updateTaxRates(
      { id: existingRate.id },
      {
        rate: OVER_2500_RATE_PERCENT,
        rules: [{ reference: "product_type", reference_id: overTypeId }],
      }
    )
    logger.info(
      `Reconciled tax_rate ${existingRate.id} → ${OVER_2500_RATE_PERCENT}% bound to product_type ${overTypeId}`
    )
    return
  }

  const created = await taxService.createTaxRates([
    {
      tax_region_id: inRegion.id,
      name: OVER_2500_RATE_NAME,
      code: OVER_2500_RATE_CODE,
      rate: OVER_2500_RATE_PERCENT,
      is_default: false,
      rules: [{ reference: "product_type", reference_id: overTypeId }],
    },
  ])
  const newRate = Array.isArray(created) ? created[0] : created
  logger.info(
    `Created tax_rate ${newRate?.id} (${OVER_2500_RATE_PERCENT}% scoped to product_type ${overTypeId})`
  )
}
