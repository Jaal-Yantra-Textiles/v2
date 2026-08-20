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
import { refetchBatchVariants } from "@medusajs/medusa/api/admin/products/helpers"
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
  /**
   * Response field set, straight from `req.queryConfig.fields` the way core
   * does it. Omitted → `BATCH_VARIANT_FIELDS`.
   *
   * ⚠️ Narrowing this is a real trade: the FX fanout is driven by
   * `collectVariantPriceIds`, which reads the `prices` the enrichment built.
   * Drop the price fields and the fanout goes quiet — without erroring.
   */
  fields?: string[]
}

/**
 * DEFAULT field set — what a caller gets when it does not ask for less.
 *
 * This is core's `defaultAdminProductsVariantFields` (its own batch default)
 * minus `thumbnail` and `deleted_at`, with the price keys written pre-remapped.
 * `remapKeysForVariant` only rewrites fields starting with `prices`/`*prices`,
 * so `price_set.prices.*` passes through untouched and lands on the same query
 * core's `*prices` would — `remapVariantResponse` needs it to build `prices`,
 * which `collectVariantPriceIds` then reads to drive the FX fanout. Getting
 * this wrong would not fail loudly: the response would carry no prices and the
 * fanout would silently have nothing to do.
 *
 * ⚠️ It is a DEFAULT, not a ceiling — that distinction is the whole point.
 * Core reaches `refetchBatchVariants` with `req.queryConfig.fields`, so an
 * admin client can shrink the set with `?fields=`. This route hard-coded the
 * list instead, so its one caller (the partner-ui pricing screen) had no way
 * to ask for less — and that caller discards the entire body, then refetches.
 * See #1370.
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

/**
 * Resolve the caller's field set, and guarantee price ids are in it.
 *
 * The FX fanout needs the ids of prices the write CREATED — an update that adds
 * a currency sends no id, so that one is only knowable from the re-read. If a
 * caller narrows `fields` past the prices, those never fan out: no error, no
 * log, the price simply reads "not available" in every other region. That is
 * #1370 Open 1 all over again.
 *
 * So the invariant lives here rather than in each client's query string. A
 * caller can shrink the response as far as it likes; it cannot shrink it below
 * what the fanout needs. `price_set.prices.id` alone is cheap — it is the id
 * column, not the full price payload.
 */
export const withPriceIds = (fields?: string[]): string[] => {
  if (!fields?.length) return BATCH_VARIANT_FIELDS
  const hasPrices = fields.some(
    (f) =>
      f.startsWith("price_set.prices") ||
      f.startsWith("prices") ||
      f.startsWith("*prices")
  )
  return hasPrices ? fields : [...fields, "price_set.prices.id"]
}

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
 * Re-read the written variants. The expensive step.
 *
 * Returns them RAW, with `price_set` intact — `remapVariantResponse` is HTTP
 * presentation and is applied by the route, exactly as core's admin batch route
 * does it. A workflow that returned an HTTP-shaped DTO would hand the same
 * shape to a subscriber or a script that never asked for it.
 *
 * Read-only, so no compensation: nothing to undo.
 */
export const enrichBatchVariantsStep = createStep(
  "enrich-batch-variants",
  async (
    input: {
      created: any[]
      updated: any[]
      deleted: string[]
      fields: string[]
    },
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
      input.fields
    )

    const created = batchResults.created ?? []
    const updated = batchResults.updated ?? []

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
        transform({ input, facts }, ({ input, facts }) => ({
          created: facts.created,
          updated: facts.updated,
          deleted: facts.deleted,
          fields: withPriceIds(input.fields),
        }))
      )
    })

    // Medusa's pricing module emits no `price.created` we could subscribe to,
    // so the fanout is kicked off here for every price the batch touched.
    //
    // ⚠️ The price ids come from BOTH the request and the enrichment, and that
    // is not belt-and-braces — it is what makes `fields` safe to narrow.
    // `collectVariantPriceIds` reads the `prices` the enrichment built, so a
    // caller sending `?fields=id` would silently starve the fanout: no error,
    // no log, prices simply never converted into the store's other currencies.
    // That is the exact failure #1370 Open 1 already shipped once. An UPDATE
    // carries its price ids in the request body, so we take them from there and
    // only lean on the enrichment for prices that did not exist until the write.
    const fanoutInput = transform(
      { input, enriched },
      ({ input, enriched }) => {
        const fromRequest: string[] = []
        for (const u of input.update ?? []) {
          for (const pr of u?.prices ?? []) {
            if (pr?.id) fromRequest.push(String(pr.id))
          }
        }
        // Works on the RAW variants: collectVariantPriceIds falls back to
        // `price_set.prices` when `prices` is absent, which is precisely the
        // shape the step now returns.
        const fromEnrichment = collectVariantPriceIds([
          ...((enriched as any)?.created ?? []),
          ...((enriched as any)?.updated ?? []),
        ])
        return {
          storeId: input.storeId,
          priceIds: Array.from(new Set([...fromRequest, ...fromEnrichment])),
        }
      }
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
