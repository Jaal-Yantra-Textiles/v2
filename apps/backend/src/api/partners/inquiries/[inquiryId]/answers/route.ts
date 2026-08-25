import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"

import {
  inquiryWriteRefusal,
  listInquiryQuestions,
  listResponseAnswers,
  loadInquiryForPartner,
} from "../../../../../modules/design_inquiry/lib/partner-inquiry-access"
import { saveInquiryAnswers } from "../../../../../modules/design_inquiry/lib/save-inquiry-answers"
import { getPartnerFromAuthContext } from "../../../helpers"
import type { PartnerPostInquiryAnswersReq } from "../../validators"

/**
 * POST /partners/inquiries/:inquiryId/answers — save a step of the wizard.
 *
 * Separate from submitting on purpose. A partner answering on a phone at a
 * loom loses their connection halfway through; every step is written as it is
 * completed, and the wizard resumes from what is stored rather than from
 * whatever survived in a tab.
 *
 * Saving is NOT answering. The response has no verdict until `submit`, so a
 * half-filled wizard still reads as silence in the comparison — which is
 * honest, and is the whole reason the empty response row exists from invite
 * time.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest<PartnerPostInquiryAnswersReq>,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner?.id) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "No partner associated with this account"
    )
  }

  const { inquiry, response } = await loadInquiryForPartner(req.scope, {
    inquiry_id: req.params.inquiryId,
    partner_id: partner.id,
  })

  const refusal = inquiryWriteRefusal(inquiry)
  if (refusal) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, refusal)
  }

  const body = ((req as any).validatedBody ||
    req.body) as PartnerPostInquiryAnswersReq

  const questions = await listInquiryQuestions(req.scope, inquiry.id)

  const saved = await saveInquiryAnswers(req.scope, {
    response: { id: response.id, partner_id: partner.id },
    questions,
    answers: body.answers,
  })

  // The full set is returned, not just what was written: the wizard's next
  // render is the answers as they now stand, and a client that has to merge a
  // partial write into its own copy is a client that can disagree with the
  // server about what the partner said.
  const answers = await listResponseAnswers(req.scope, response.id)

  return res.json({ answers, ...saved })
}
