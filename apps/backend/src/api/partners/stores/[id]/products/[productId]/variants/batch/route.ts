import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  logWorkflowPhases,
  validatePartnerStoreAccess,
} from "../../../../../../helpers"
import { remapVariantResponse } from "@medusajs/medusa/api/admin/products/helpers"
import { batchPartnerVariantsWorkflow } from "../../../../../../../../workflows/partner/batch-partner-variants"

/**
 * POST /partners/stores/:id/products/:productId/variants/batch
 *
 * Auth is all this route contributes. The write, the stock-level seeding, the
 * response enrichment and the FX fanout live in `batch-partner-variants` so the
 * partner write paths are described in one place (#1380).
 *
 * ⚠️ The 5-29s saves this route is known for are NOT fixed by that move — the
 * cost is inside the enrichment re-read, which the workflow carries over
 * unchanged. See the workflow's header before theorising: three explanations
 * are already dead.
 *
 * Phase timing stays on and stays `info`. The slow saves are intermittent, and
 * a flag we turn on after a partner complains is a flag that was off during
 * every occurrence worth measuring.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const t0 = Date.now()

  const { store } = await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )
  const authMs = Date.now() - t0

  const body = (req.body ?? {}) as Record<string, any>

  const { result } = await batchPartnerVariantsWorkflow(req.scope).run({
    input: {
      storeId: store.id,
      productId: req.params.productId,
      store,
      create: body.create,
      update: body.update,
      delete: body.delete,
      // Core reaches `refetchBatchVariants` with `req.queryConfig.fields`; this
      // route hard-coded the list, so its only caller could not ask for less.
      // Same wiring as core now — the default is unchanged for anyone who
      // sends no `?fields=`.
      fields: (req as any).queryConfig?.fields,
    },
  })

  logWorkflowPhases(
    logger,
    "variants/batch",
    req.get("x-request-id") || "-",
    Date.now() - t0,
    { auth: authMs, ...result.phases }
  )

  // Response shaping stays at the HTTP edge, same as core's admin batch route.
  // The workflow returns raw variants with `price_set` intact; `prices` is a
  // wire concern.
  res.json({
    created: result.created.map((v: any) => remapVariantResponse(v)),
    updated: result.updated.map((v: any) => remapVariantResponse(v)),
    deleted: result.deleted,
  })
}
