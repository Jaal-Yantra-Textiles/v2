import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"

import {
  generateInquiryQuestions,
  resolveSpecVersion,
} from "../../../../../../workflows/design-inquiries/generate-questions"
import type { AdminPostDesignInquiryPreviewReq } from "../validators"

/**
 * POST /admin/designs/:id/inquiries/preview — the questions this design would
 * generate, without creating anything or telling anyone.
 *
 * Exists because the questions come from the spec, and a spec with a thin
 * Materials section produces a thin wizard. Seeing that before a partner does
 * is the difference between fixing the spec and being politely told it makes
 * no sense.
 */
export const POST = async (
  req: MedusaRequest<AdminPostDesignInquiryPreviewReq>,
  res: MedusaResponse
) => {
  const body = (req as any).validatedBody || req.body || {}
  const query: any = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const {
    data: [design],
  } = await query.graph({
    entity: "design",
    fields: ["id", "name", "specifications.*", "colors.*"],
    filters: { id: req.params.id },
  })

  if (!design) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Design ${req.params.id} not found`
    )
  }

  const specifications = (design as any).specifications ?? []
  const questions = generateInquiryQuestions({
    specifications,
    colours: ((design as any).colors ?? []).map((c: any) => ({
      id: c?.id ?? null,
      value: c?.name ?? "",
      hex: c?.hex_code ?? null,
    })),
    categories: body.categories,
  })

  return res.json({
    design_id: (design as any).id,
    spec_version: resolveSpecVersion(specifications),
    questions,
    count: questions.length,
  })
}
