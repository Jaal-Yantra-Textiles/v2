import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { batchProductVariantsWorkflow } from "@medusajs/medusa/core-flows"
import { remapVariantResponse } from "@medusajs/medusa/api/admin/products/helpers"
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

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const createdIds = result.created?.map((v: any) => v.id) ?? []
  const updatedIds = result.updated?.map((v: any) => v.id) ?? []

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
   * Measured on prod, warm, with the phase log this route already emits:
   *
   *   product                       variants written   responseQueries
   *   ikkat      (1 option  x 2 values)      2               327 ms
   *   grey/white (3 options x 3 values)      1              3211 ms
   *   grey/white (3 options x 3 values)      9             15094 ms
   *
   * ONE variant of the option-heavy product cost 10x what TWO variants of the
   * simple one did, so the cost tracks the product's OPTION graph and not the
   * number of variants written. `options.option.*` walks from each variant's
   * option VALUE back to the product option it belongs to — the same handful of
   * parent options, re-resolved per variant, per value.
   *
   * Neither `options.option` nor `inventory_items` is read by anything.
   * `remapVariantResponse` only reshapes `price_set.prices`, and the sole
   * caller of this route (partner-ui `pricing-edit.tsx`) ignores the response
   * body entirely — its `onSuccess` invalidates its queries and works from
   * state it computed before the request. They were pass-through weight.
   *
   * `options.*` stays: it is a direct FK read on the variant, and it is what
   * makes the returned variant identifiable as "Hand Spun / Grey".
   */
  const variantFields = [
    "*",
    "product_id",
    "price_set.prices.*",
    "price_set.prices.price_rules.*",
    "options.*",
  ]

  let created: any[] = []
  let updated: any[] = []

  // One query, not two. `created` and `updated` were fetched separately with
  // identical field sets, so a batch doing both paid the enrichment twice.
  const idsToFetch = [...createdIds, ...updatedIds]
  if (idsToFetch.length) {
    const { data } = await query.graph({
      entity: "product_variants",
      fields: variantFields,
      filters: { id: idsToFetch },
    })
    const createdSet = new Set(createdIds)
    for (const row of data as any[]) {
      const mapped = remapVariantResponse(row)
      if (createdSet.has(row.id)) {
        created.push(mapped)
      } else {
        updated.push(mapped)
      }
    }
  }
  // Counts are logged alongside the timing because the whole diagnosis above
  // turned on cost-per-variant differing 10x between two products. A duration
  // with no denominator could not have shown that.
  timer.mark(
    `responseQueries(n=${idsToFetch.length})`
  )

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
