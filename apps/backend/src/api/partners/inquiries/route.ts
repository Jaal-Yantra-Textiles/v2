import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"

import { DESIGN_INQUIRY_MODULE } from "../../../modules/design_inquiry"
import type DesignInquiryService from "../../../modules/design_inquiry/service"
import { getPartnerFromAuthContext } from "../helpers"

/**
 * How many of one partner's inquiries are read whole before filtering.
 *
 * Not pagination — a ceiling, so a partner with a pathological history cannot
 * turn one list call into an unbounded read. Real partners sit in the tens; if
 * this is ever reached the list silently truncates, which is why it is a named
 * constant rather than a number buried in a call.
 */
const MAX_PARTNER_INQUIRIES = 500

/**
 * GET /partners/inquiries — every inquiry this partner has been asked to
 * answer (#1531 slice 2).
 *
 * 🔴 The list is built from the partner's own RESPONSE rows, not from
 * inquiries filtered afterwards. There is no query here that could return an
 * inquiry this partner was not invited to, so no later edit can accidentally
 * widen it — the same reasoning as `loadInquiryForPartner`. An inquiry is one
 * design shown to several competing partners; its existence is confidential to
 * the ones asked.
 *
 * Each row carries the design's name and a question count, because a partner
 * deciding which of four asks to answer first needs to know what it is about
 * and how long it will take — and because a list of opaque ids is a list
 * nobody opens.
 */
export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner?.id) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "No partner associated with this account"
    )
  }

  const service: DesignInquiryService = req.scope.resolve(DESIGN_INQUIRY_MODULE)
  const query: any = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const validated = ((req as any).validatedQuery || req.query || {}) as {
    status?: "open" | "closed"
    limit?: number
    offset?: number
  }
  const take = Number(validated.limit ?? 20)
  const skip = Number(validated.offset ?? 0)

  /**
   * 🔴 Every one of this partner's response rows, then filter, then paginate —
   * in that order, and not the obvious one.
   *
   * Paginating FIRST and filtering by `status` afterwards returns a page of
   * fewer rows than asked for beside a count that describes something else, so
   * "3 open inquiries" would be a number nobody could act on and nothing would
   * look broken. This whole area has shipped that shape too many times.
   *
   * The status lives on the INQUIRY and the page is driven by the RESPONSE, so
   * there is no single query that does both. Reading the partner's own rows
   * whole is the honest way round: it is bounded by one partner (tens of rows,
   * not thousands), unlike listing every open inquiry on the platform to get
   * its ids.
   */
  const responses = await service.listDesignInquiryResponses(
    { partner_id: partner.id } as any,
    { order: { created_at: "DESC" }, take: MAX_PARTNER_INQUIRIES }
  )

  const inquiryIds = Array.from(
    new Set((responses ?? []).map((r: any) => r.inquiry_id).filter(Boolean))
  )

  /**
   * ⚠️ An empty page must NOT fall through to an unfiltered read.
   * `filters: { id: [] }` is not reliably "no rows" and `{ id: undefined }` is
   * definitively no filter at all — which is how a dangling key once returned
   * every tenant's data (#1397). A partner with no inquiries gets the empty
   * list without asking the database anything.
   */
  const inquiriesById = new Map<string, any>()
  if (inquiryIds.length) {
    const inquiries = await service.listDesignInquiries({
      id: inquiryIds,
    } as any)
    for (const inquiry of inquiries ?? []) {
      inquiriesById.set(inquiry.id, inquiry)
    }
  }

  const designIds = Array.from(
    new Set(
      Array.from(inquiriesById.values())
        .map((i: any) => i.design_id)
        .filter(Boolean)
    )
  )
  const designsById = new Map<string, any>()
  if (designIds.length) {
    const { data: designs = [] } = await query.graph({
      entity: "design",
      fields: ["id", "name", "thumbnail_url"],
      filters: { id: designIds },
    })
    for (const design of designs ?? []) designsById.set(design.id, design)
  }

  const questionCounts = new Map<string, number>()
  if (inquiryIds.length) {
    const questions = await service.listDesignInquiryQuestions({
      inquiry_id: inquiryIds,
    } as any)
    for (const question of questions ?? []) {
      questionCounts.set(
        question.inquiry_id,
        (questionCounts.get(question.inquiry_id) ?? 0) + 1
      )
    }
  }

  const all = (responses ?? [])
    .map((response: any) => {
      const inquiry = inquiriesById.get(response.inquiry_id)
      if (!inquiry) return null
      const design = designsById.get(inquiry.design_id)
      return {
        id: inquiry.id,
        design_id: inquiry.design_id,
        design_name: design?.name ?? null,
        design_thumbnail: design?.thumbnail_url ?? null,
        title: inquiry.title,
        brief_note: inquiry.brief_note ?? null,
        status: inquiry.status,
        spec_version: inquiry.spec_version ?? null,
        question_count: questionCounts.get(inquiry.id) ?? 0,
        created_at: inquiry.created_at,
        closed_at: inquiry.closed_at ?? null,
        // The partner's own progress. `verdict: null` with an `invited_at` is
        // the silence the response row exists to make visible.
        response: {
          id: response.id,
          verdict: response.verdict ?? null,
          lead_time_days: response.lead_time_days ?? null,
          indicative_price: response.indicative_price ?? null,
          currency_code: response.currency_code ?? null,
          invited_at: response.invited_at ?? null,
          submitted_at: response.submitted_at ?? null,
        },
      }
    })
    .filter(Boolean) as any[]

  const filtered = validated.status
    ? all.filter((r: any) => r.status === validated.status)
    : all

  // The count describes the filtered set, which is the set being paged.
  return res.json({
    inquiries: filtered.slice(skip, skip + take),
    count: filtered.length,
    limit: take,
    offset: skip,
  })
}
