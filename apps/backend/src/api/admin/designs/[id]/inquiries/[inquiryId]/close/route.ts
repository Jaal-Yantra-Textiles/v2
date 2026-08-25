import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { closeDesignInquiryWorkflow } from "../../../../../../../workflows/design-inquiries/close-design-inquiry"
import type { AdminPostCloseDesignInquiryReq } from "../../validators"

/**
 * POST /admin/designs/:id/inquiries/:inquiryId/close
 *
 * Closes the inquiry AND takes the brief back from everyone who was asked —
 * except a named winner, whose access is promoted rather than withdrawn.
 */
export const POST = async (
  req: MedusaRequest<AdminPostCloseDesignInquiryReq>,
  res: MedusaResponse
) => {
  const body = (req as any).validatedBody || req.body || {}

  const { result } = await closeDesignInquiryWorkflow(req.scope).run({
    input: {
      inquiry_id: req.params.inquiryId,
      chosen_partner_id: body.chosen_partner_id ?? null,
      chosen_role: body.chosen_role,
    },
  })

  return res.json(result)
}
