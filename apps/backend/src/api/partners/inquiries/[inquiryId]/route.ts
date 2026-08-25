import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"

import {
  listInquiryQuestions,
  listResponseAnswers,
  loadInquiryForPartner,
} from "../../../../modules/design_inquiry/lib/partner-inquiry-access"
import { getPartnerFromAuthContext } from "../../helpers"

/**
 * GET /partners/inquiries/:inquiryId — the wizard, as this partner sees it.
 *
 * Questions in their generated order, this partner's own answers so far, the
 * design's name and reference images, and nothing whatsoever belonging to the
 * other partners asked.
 *
 * 🔑 The questions are the PERSISTED rows, never regenerated from the design's
 * current spec. A spec moves while sourcing runs — the inquiry records
 * `spec_version` precisely because of it — and a wizard that silently reworded
 * itself between being sent and being answered would make "yes we can do that"
 * unreadable, because it would no longer say which "that".
 */
export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner?.id) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "No partner associated with this account"
    )
  }

  // Throws 404 — not 403 — when this partner was not invited. Being uninvited
  // and not existing are the same answer: the existence of an inquiry names a
  // design being sourced, and that is itself the confidential part.
  const { inquiry, response } = await loadInquiryForPartner(req.scope, {
    inquiry_id: req.params.inquiryId,
    partner_id: partner.id,
  })

  const query: any = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const [questions, answers] = await Promise.all([
    listInquiryQuestions(req.scope, inquiry.id),
    listResponseAnswers(req.scope, response.id),
  ])

  let design: any = null
  if (inquiry.design_id) {
    const { data = [] } = await query.graph({
      entity: "design",
      // Deliberately narrow. A prospect grant is read access to an UNRELEASED
      // design (#1496 shape); they are shown what they need to answer the
      // questions and not the costings, the customer, or who else was asked.
      fields: ["id", "name", "description", "thumbnail_url"],
      filters: { id: inquiry.design_id },
    })
    design = (data ?? [])[0] ?? null
  }

  return res.json({
    inquiry: {
      id: inquiry.id,
      design_id: inquiry.design_id,
      title: inquiry.title,
      brief_note: inquiry.brief_note ?? null,
      reference_media_ids: inquiry.reference_media_ids ?? [],
      spec_version: inquiry.spec_version ?? null,
      status: inquiry.status,
      created_at: inquiry.created_at,
      closed_at: inquiry.closed_at ?? null,
    },
    design,
    questions,
    response: {
      id: response.id,
      verdict: response.verdict ?? null,
      lead_time_days: response.lead_time_days ?? null,
      indicative_price: response.indicative_price ?? null,
      currency_code: response.currency_code ?? null,
      notes: response.notes ?? null,
      channel: response.channel,
      invited_at: response.invited_at ?? null,
      submitted_at: response.submitted_at ?? null,
    },
    answers,
  })
}
