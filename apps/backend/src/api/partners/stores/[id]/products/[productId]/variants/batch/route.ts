import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { batchProductVariantsWorkflow } from "@medusajs/medusa/core-flows"
import {
  refetchBatchVariants,
  remapVariantResponse,
} from "@medusajs/medusa/api/admin/products/helpers"
import {
  collectVariantPriceIds,
  requestVariantPriceFanout,
} from "../../../../../../../../workflows/fx/fanout-variant-prices"
import {
  ensureInventoryLevelsForVariants,
  validatePartnerStoreAccess,
} from "../../../../../../helpers"

/**
 * Phase timing for this route.
 *
 * Partner price saves through here run 5-29s (8.4s / 17.0s / 5.1s / 28.6s over
 * four prod samples) against a database sitting at 3-5% CPU with full burst
 * credits and sub-millisecond latency — so the cost is in-process, not the DB,
 * and the variance is large enough that averages would lie.
 *
 * Log evidence already narrows it: on the 28.6s sample the request began at
 * 01:00:15.1 and `product-variant.updated` fired at 01:00:15.9, so the actual
 * variant write took under a second and ~27.5s went somewhere after it. This
 * says exactly where, on real partner traffic, without a reproduction.
 *
 * Deliberately `info` and always on: the slow saves are intermittent, and a
 * flag we have to turn on after a partner complains is a flag that is off
 * during every occurrence worth measuring.
 */
const phaseTimer = (logger: any, requestId: string) => {
  const t0 = Date.now()
  let last = t0
  const marks: string[] = []
  return {
    mark(name: string) {
      const now = Date.now()
      marks.push(`${name}=${now - last}ms`)
      last = now
    },
    done() {
      logger?.info?.(
        `[variants/batch] ${requestId} total=${Date.now() - t0}ms ${marks.join(" ")}`
      )
    },
  }
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const timer = phaseTimer(logger, req.get("x-request-id") || "-")

  const { store } = await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )
  timer.mark("auth")

  const productId = req.params.productId
  const body = (req.body ?? {}) as Record<string, any>

  const input = {
    create: body.create?.map((c: any) => ({ ...c, product_id: productId })),
    update: body.update?.map((u: any) => ({ ...u, product_id: productId })),
    delete: body.delete,
  }

  const { result } = await batchProductVariantsWorkflow(req.scope).run({
    input,
  })
  timer.mark("batchWorkflow")

  const createdIds = result.created?.map((v: any) => v.id) ?? []

  // Auto-seed inventory_level rows at the partner's stock location for any
  // managed-inventory variants in the create batch. Same gap the single-POST
  // route plugs — without this, the partner-ui inventory page 404s when
  // partners try to manage stocks for batch-created variants.
  if (createdIds.length) {
    await ensureInventoryLevelsForVariants(req.scope, store, createdIds)
  }
  timer.mark("inventoryLevels")

  /**
   * Response enrichment. This was ~97% of the request.
   *
   *   [variants/batch] total=16364ms auth=26ms batchWorkflow=358ms
   *                    inventoryLevels=0ms responseQueries=15977ms fanoutEmit=3ms
   *
   * The write is 358ms. The re-read that shapes the response was 15977ms.
   *
   * This route hand-rolled that re-read. Medusa's own admin batch route does
   * not — `admin/products/[id]/variants/batch` calls `refetchBatchVariants`,
   * and comparing the two is what identified the difference:
   *
   *   - core fires the `created` and `updated` queries CONCURRENTLY through
   *     `promiseAll`; we awaited them one after the other.
   *   - core goes through `remoteQuery` (`entryPoint: "variant"`); we used
   *     `query.graph({ entity: "product_variants" })`.
   *   - core's default field set is an explicit list of scalars plus `*options`
   *     and two named `price_rules` fields. It never expands `options.option`,
   *     never asks for `inventory_items`, and never uses a bare `"*"`.
   *
   * So: use core's helper, with an explicit field list rather than a wide one.
   * `refetchBatchVariants` is exported from the same module this file already
   * imports `remapVariantResponse` from, so the response shape is unchanged.
   *
   * ⚠️ What the evidence does NOT support: that the wide fields were themselves
   * the cost. The same expansion — `options.option.*` and `inventory_items.*`
   * included — over the same 9 variants returns in ~1.3s through the admin read
   * path, verified against prod, fields honoured rather than stripped. An
   * earlier reading of these numbers blamed the product's option graph; that
   * did not survive the check. What is left is the mechanism: the engine, the
   * sequential await, and the fact that this query runs on the request scope
   * immediately after that scope performed the write. This change aligns all
   * three with core, which is the version that is actually exercised and tuned.
   *
   * Measured warm on prod before the change:
   *
   *   product                       variants written   responseQueries
   *   ikkat      (1 option  x 2 values)      2               327 ms
   *   grey/white (3 options x 3 values)      1              3211 ms
   *   grey/white (3 options x 3 values)      9             15094 ms
   */
  const variantFields = [
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
    // Written pre-remapped. `remapKeysForVariant` only rewrites fields starting
    // with `prices`/`*prices`, so these pass through untouched — and
    // `remapVariantResponse` needs `price_set.prices` to build `prices`, which
    // `collectVariantPriceIds` then reads to drive the FX fanout below. Getting
    // this wrong would not fail loudly: the response would simply carry no
    // prices and the fanout would silently have nothing to do.
    "price_set.prices.*",
    "price_set.prices.price_rules.value",
    "price_set.prices.price_rules.attribute",
  ]

  const batchResults = await refetchBatchVariants(
    {
      created: result.created ?? [],
      updated: result.updated ?? [],
      deleted: result.deleted ?? [],
    },
    req.scope,
    variantFields
  )

  const created = batchResults.created.map((v: any) => remapVariantResponse(v))
  const updated = batchResults.updated.map((v: any) => remapVariantResponse(v))

  // The row count rides along with the timing. This whole diagnosis turned on
  // cost-per-variant differing 10x between two products, and a duration with no
  // denominator could not have shown that.
  timer.mark(`responseQueries(n=${created.length + updated.length})`)

  // FX fanout — Medusa's pricing module doesn't emit a `price.created`
  // event we can subscribe to, so we kick off the fanout workflow here for
  // every non-auto price on the touched variants. Idempotent + never throws;
  // see fanout-variant-prices.ts.
  const touched = [...created, ...updated]
  await requestVariantPriceFanout(req.scope, {
    storeId: store.id,
    priceIds: collectVariantPriceIds(touched),
  })
  timer.mark("fanoutEmit")
  timer.done()

  res.json({
    created,
    updated,
    deleted: {
      ids: result.deleted ?? [],
      object: "product_variant",
      deleted: true,
    },
  })
}
