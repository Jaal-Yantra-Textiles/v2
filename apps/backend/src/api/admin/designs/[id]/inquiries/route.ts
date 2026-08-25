import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { createDesignInquiryWorkflow } from "../../../../../workflows/design-inquiries/create-design-inquiry"
import { DESIGN_INQUIRY_MODULE } from "../../../../../modules/design_inquiry"
import type DesignInquiryService from "../../../../../modules/design_inquiry/service"
import type { AdminPostDesignInquiryReq } from "./validators"

/**
 * POST /admin/designs/:id/inquiries — ask a set of partners what they can make.
 */
export const POST = async (
  req: MedusaRequest<AdminPostDesignInquiryReq>,
  res: MedusaResponse
) => {
  const body = (req as any).validatedBody || req.body

  const { result } = await createDesignInquiryWorkflow(req.scope).run({
    input: {
      design_id: req.params.id,
      partner_ids: body.partner_ids,
      title: body.title,
      brief_note: body.brief_note,
      reference_media_ids: body.reference_media_ids,
      categories: body.categories,
      created_by: (req as any).auth_context?.actor_id ?? null,
    },
  })

  return res.status(201).json(result)
}

/**
 * GET /admin/designs/:id/inquiries — every inquiry on this design with its
 * questions and each partner's response, which is the comparison view: one row
 * per partner asked, including the ones who have said nothing.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: DesignInquiryService = req.scope.resolve(DESIGN_INQUIRY_MODULE)
  const query: any = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const [inquiries, count] = await service.listAndCountDesignInquiries(
    { design_id: req.params.id },
    { order: { created_at: "DESC" } }
  )

  const detailed = await Promise.all(
    (inquiries || []).map(async (inquiry: any) => {
      const { data } = await query.graph({
        entity: "design_inquiry",
        fields: ["id", "questions.*", "responses.*", "responses.answers.*"],
        filters: { id: inquiry.id },
      })
      const graphed = (data || [])[0] || {}
      return {
        ...inquiry,
        questions: graphed.questions ?? [],
        responses: graphed.responses ?? [],
      }
    })
  )

  return res.json({ inquiries: detailed, count })
}
