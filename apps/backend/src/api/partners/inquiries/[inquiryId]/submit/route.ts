import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"

import { DESIGN_INQUIRY_MODULE } from "../../../../../modules/design_inquiry"
import type DesignInquiryService from "../../../../../modules/design_inquiry/service"
import {
  inquiryWriteRefusal,
  listInquiryQuestions,
  listResponseAnswers,
  loadInquiryForPartner,
} from "../../../../../modules/design_inquiry/lib/partner-inquiry-access"
import { saveInquiryAnswers } from "../../../../../modules/design_inquiry/lib/save-inquiry-answers"
import { getPartnerFromAuthContext } from "../../../helpers"
import type { PartnerPostInquirySubmitReq } from "../../validators"

/**
 * POST /partners/inquiries/:inquiryId/submit — the partner's verdict.
 *
 * 🔑 Submitting is not final while the inquiry is open. A partner who finds a
 * better yarn on Thursday should be able to say so, and a wizard that locks on
 * first submit teaches people to delay answering until they are certain —
 * which is exactly the silence this whole feature exists to end. `submitted_at`
 * moves to the latest submission; the previous verdict is simply replaced,
 * because the comparison shows what a partner says they can make TODAY.
 *
 * 🔴 `channel` is written as `wizard` from the route, never taken from the
 * body. It records how an answer arrived, and the channels have different
 * reliability: an `admin` row is someone typing up a WhatsApp conversation
 * from memory, a `wizard` row is the partner's own structured answer. A caller
 * able to set it could dress up hearsay as evidence — and the whole point of
 * keeping the field is being able to tell the two apart later.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest<PartnerPostInquirySubmitReq>,
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
    req.body) as PartnerPostInquirySubmitReq

  /**
   * Answers first, verdict second.
   *
   * If a question id is wrong or a photograph is not theirs to attach,
   * `saveInquiryAnswers` throws and nothing is written — including the
   * verdict. The reverse order would leave a response marked submitted
   * alongside the answers it was supposed to be a summary of, missing. A
   * partially submitted reply that says `can_make` is worse than an unanswered
   * one, because someone acts on it.
   */
  const saved = await saveInquiryAnswers(req.scope, {
    response: { id: response.id, partner_id: partner.id },
    questions: await listInquiryQuestions(req.scope, inquiry.id),
    answers: body.answers ?? [],
  })

  const service: DesignInquiryService = req.scope.resolve(DESIGN_INQUIRY_MODULE)

  /**
   * 🔴 NOT array-destructured. `updateX` returns whatever the inner service
   * returns: the `{ selector, data }` bulk form yields an ARRAY, the bare
   * entity form used here yields a SINGLE OBJECT. Destructuring it throws
   * `TypeError: (intermediate value) is not iterable` — after the write has
   * landed, so the caller sees a failure and retries something that already
   * ran. That shipped once on the quote revoke route and is not worth
   * rediscovering here.
   */
  const updated = await service.updateDesignInquiryResponses({
    id: response.id,
    verdict: body.verdict,
    lead_time_days: body.lead_time_days ?? null,
    indicative_price: body.indicative_price ?? null,
    currency_code: body.currency_code
      ? String(body.currency_code).toLowerCase()
      : null,
    notes: body.notes ?? null,
    channel: "wizard",
    submitted_at: new Date(),
  } as any)

  const answers = await listResponseAnswers(req.scope, response.id)

  return res.json({
    response: updated ?? { ...response, verdict: body.verdict },
    answers,
    ...saved,
  })
}
