import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { inferDesignProductTypeWorkflow } from "../../../../../workflows/designs/infer-design-product-type"
import { DESIGN_MODULE } from "../../../../../modules/designs"
import type DesignService from "../../../../../modules/designs/service"

/**
 * POST /admin/designs/:id/product-type
 *
 * Ask the model to (re-)infer this design's garment type (#938).
 *
 * The type is what makes a production spec derivable, so it is worth being able
 * to re-run on demand — a design whose description was fleshed out after
 * creation may now be classifiable when it was not before.
 *
 * Body: `{ force?: boolean }`
 *
 * `force` is what lets this overwrite a MANUALLY set type. Inference will not
 * do that on its own (see `mayInferOver`), because a designer's correction
 * being silently undone moves the production spec — and therefore the cost —
 * underneath them. Passing `force` is a person asking, which is different.
 *
 * Response mirrors the workflow: `skipped` plus a `skip_reason` whenever
 * nothing was written, rather than a bare 200 that looks like success.
 *
 * 🔑 To SET a type by hand, PATCH the design with `product_type` instead. This
 * route is only ever the model's opinion.
 */
export async function POST(
  req: MedusaRequest & { params: { id: string } },
  res: MedusaResponse
): Promise<void> {
  const designId = req.params.id
  const force = Boolean((req.body as any)?.force)

  const designService: DesignService = req.scope.resolve(DESIGN_MODULE)
  // Fail loudly on an unknown design rather than letting the workflow report
  // `skipped: "design_not_found"` as a 200 — a bad id is the caller's error.
  try {
    await designService.retrieveDesign(designId)
  } catch {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Design with id ${designId} not found`
    )
  }

  const { result } = await inferDesignProductTypeWorkflow(req.scope).run({
    input: { design_id: designId, force },
  })

  const design = await designService.retrieveDesign(designId)

  res.json({ design, inference: result })
}
