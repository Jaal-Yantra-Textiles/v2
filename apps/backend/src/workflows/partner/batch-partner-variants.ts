/**
 * #1380 / #1370 — the partner variants/batch write, as one workflow.
 *
 * Companion to `create-partner-product`: same shape, same gating discipline, so
 * the two partner write paths are described the same way.
 *
 * ⚠️ READ THIS BEFORE TREATING IT AS A LATENCY FIX. It is not one. The cost on
 * this route lives inside `refetchBatchVariants`, and that call is carried over
 * here unchanged and still runs on the request scope immediately after that
 * scope performed the write:
 *
 *   [variants/batch] total=16364ms auth=26ms batchWorkflow=358ms
 *                    inventoryLevels=0ms responseQueries=15977ms fanoutEmit=3ms
 *
 * The write is 358ms; the re-read was 15977ms. Moving the same query into a
 * step does not make it cheaper. What this DOES buy is the ability to skip work
 * that never needed to run, and a phase map that says `skipped` instead of
 * `0ms` so a skipped branch can never again be misread as a free one.
 *
 * Three theories about the re-read are already dead — the option graph, core's
 * `refetchBatchVariants` being the wrong helper, and inline subscribers. Do not
 * add a fourth here.
 */
import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
  when,
  transform,
} from "@medusajs/framework/workflows-sdk"
import { batchProductVariantsWorkflow } from "@medusajs/medusa/core-flows"
import {
  refetchBatchVariants,
  remapVariantResponse,
} from "@medusajs/medusa/api/admin/products/helpers"
import { collectVariantPriceIds } from "../fx/fanout-variant-prices"
import { ensureInventoryLevelsForVariants } from "../../api/partners/helpers"
import { requestPartnerPriceFanoutStep } from "./create-partner-product"

export type BatchPartnerVariantsInput = {
  storeId: string
  productId: string
  store: { id?: string; default_sales_channel_id?: string | null }
  create?: any[]
  update?: any[]
  delete?: string[]
}

/**
 * The field list core's admin batch route uses, plus the pre-remapped price
 * keys this response needs.
 *
 * `remapKeysForVariant` only rewrites fields starting with `prices`/`*prices`,
 * so the `price_set.prices.*` entries pass through untouched — and
 * `remapVariantResponse` needs them to build `prices`, which
 * `collectVariantPriceIds` then reads to drive the FX fanout. Getting this
 * wrong would not fail loudly: the response would simply carry no prices and
 * the fanout would silently have nothing to do.
 */
export const BATCH_VARIANT_FIELDS = [
  "id",
  "title",
  "sku",
  "barcode",
  "ean",
  "upc",
  "allow_backorder",
  "manage_inventory",
  "hs_code",
  "origin_country",
  "mid_code",
  "material",
  "weight",
  "length",
  "height",
  "width",
  "metadata",
  "variant_rank",
  "product_id",
  "created_at",
  "updated_at",
  "*options",
  "price_set.prices.*",
  "price_set.prices.price_rules.value",
  "price_set.prices.price_rules.attribute",
]

export const seedBatchInventoryLevelsStep = createStep(
  "seed-batch-inventory-levels",
  async (
    input: {
      store: { id?: string; default_sales_channel_id?: string | null }
      variantIds: string[]
    },
    { container }
  ) => {
    const t0 = Date.now()
    await ensureInventoryLevelsForVariants(
      container,
      input.store,
      input.variantIds
    )
    return new StepResponse({ ms: Date.now() - t0 })
  }
)

/**
 * Re-read the written variants to shape the response. The expensive one.
 * Read-only, so it has no compensation: nothing to undo.
 */
export const enrichBatchVariantsStep = createStep(
  "enrich-batch-variants",
  async (
    input: { created: any[]; updated: any[]; deleted: string[] },
    { container }
  ) => {
    const t0 = Date.now()

    const batchResults = await refetchBatchVariants(
      {
        created: input.created,
        updated: input.updated,
        deleted: input.deleted,
      },
      container,
      BATCH_VARIANT_FIELDS
    )

    const created = batchResults.created.map((v: any) => remapVariantResponse(v))
    const updated = batchResults.updated.map((v: any) => remapVariantResponse(v))

    return new StepResponse({
      created,
      updated,
      // The row count rides along with the timing. This diagnosis turned on
      // cost-per-variant differing 10x between two products, and a duration
      // with no denominator could not have shown that.
      n: created.length + updated.length,
      ms: Date.now() - t0,
    })
  }
)

export const batchPartnerVariantsWorkflow = createWorkflow(
  "batch-partner-variants",
  function (input: BatchPartnerVariantsInput) {
    const batchInput = transform({ input }, ({ input }) => ({
      create: input.create?.map((c: any) => ({
        ...c,
        product_id: input.productId,
      })),
      update: input.update?.map((u: any) => ({
        ...u,
        product_id: input.productId,
      })),
      delete: input.delete,
    }))

    const result = batchProductVariantsWorkflow.runAsStep({
      input: batchInput as any,
    })

    const facts = transform({ result }, ({ result }) => {
      const created = (result as any)?.created ?? []
      const updated = (result as any)?.updated ?? []
      const deleted = (result as any)?.deleted ?? []
      return {
        created,
        updated,
        deleted,
        createdIds: created.map((v: any) => v?.id).filter(Boolean),
        // A delete-only batch has nothing to re-read. Today that still pays for
        // the full enrichment round trip.
        needsEnrichment: created.length > 0 || updated.length > 0,
      }
    })

    // Only a CREATE can need a new stock level; an update never does.
    const inventory = when(
      { facts },
      ({ facts }) => facts.createdIds.length > 0
    ).then(function () {
      return seedBatchInventoryLevelsStep(
        transform({ input, facts }, ({ input, facts }) => ({
          store: input.store,
          variantIds: facts.createdIds,
        }))
      )
    })

    const enriched = when(
      { facts },
      ({ facts }) => facts.needsEnrichment === true
    ).then(function () {
      return enrichBatchVariantsStep(
        transform({ facts }, ({ facts }) => ({
          created: facts.created,
          updated: facts.updated,
          deleted: facts.deleted,
        }))
      )
    })

    // Medusa's pricing module emits no `price.created` we could subscribe to,
    // so the fanout is kicked off here for every price the batch touched.
    const fanoutInput = transform(
      { input, enriched },
      ({ input, enriched }) => ({
        storeId: input.storeId,
        priceIds: collectVariantPriceIds([
          ...((enriched as any)?.created ?? []),
          ...((enriched as any)?.updated ?? []),
        ]),
      })
    )

    const fanout = when(
      { fanoutInput },
      ({ fanoutInput }) => fanoutInput.priceIds.length > 0
    ).then(function () {
      return requestPartnerPriceFanoutStep(fanoutInput)
    })

    const response = transform(
      { facts, inventory, enriched, fanout },
      ({ facts, inventory, enriched, fanout }) => ({
        created: (enriched as any)?.created ?? [],
        updated: (enriched as any)?.updated ?? [],
        deleted: {
          ids: facts.deleted,
          object: "product_variant",
          deleted: true,
        },
        phases: {
          inventoryLevels: inventory ? (inventory as any).ms : "skipped",
          [`responseQueries(n=${(enriched as any)?.n ?? 0})`]: enriched
            ? (enriched as any).ms
            : "skipped",
          fanoutEmit: fanout ? (fanout as any).ms : "skipped",
        },
      })
    )

    return new WorkflowResponse(response)
  }
)

export default batchPartnerVariantsWorkflow
