import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"

import { DESIGN_INQUIRY_MODULE } from ".."
import type DesignInquiryService from "../service"

/**
 * Reaching one partner's slice of an inquiry, and refusing everyone else
 * (#1531 slice 2).
 *
 * ## 🔴 The callee refuses. Every time.
 *
 * An inquiry is one design shown to SEVERAL competing partners. Their answers
 * — lead times, indicative prices, what they admit they cannot do — are
 * commercially the most sensitive thing either of them will tell us, and they
 * all hang off one `inquiry_id`. A route that loads the inquiry by its id and
 * trusts the caller to only look at their own row is one `.map()` away from
 * handing a weaver their competitor's price.
 *
 * That is #1496 exactly: a quote token rendered on every partner's storefront
 * because the read was scoped by nothing. The lesson written down then was
 * that the guard belongs in the function every caller must go through, not in
 * each caller. So there is no way to get an inquiry out of this module for a
 * partner without also getting the response row that proves they were invited.
 *
 * ## 🔴 And it is a 404, not a 403
 *
 * A 403 says "this exists and you may not see it" — which tells an uninvited
 * partner that a design they have never been shown is being sourced, and
 * roughly when. The existence of an inquiry is itself the confidential part.
 * Not being invited and not existing are the same answer here.
 */

export type PartnerInquiryAccess = {
  inquiry: any
  /** This partner's own response row. Created empty at invite time. */
  response: any
}

export const loadInquiryForPartner = async (
  scope: any,
  input: { inquiry_id: string; partner_id: string }
): Promise<PartnerInquiryAccess> => {
  const service: DesignInquiryService = scope.resolve(DESIGN_INQUIRY_MODULE)

  const notFound = () =>
    new MedusaError(MedusaError.Types.NOT_FOUND, "Inquiry not found")

  if (!input.inquiry_id || !input.partner_id) {
    throw notFound()
  }

  /**
   * 🔑 The response is looked up FIRST, filtered on BOTH ids together.
   *
   * Loading the inquiry first and then checking membership would work, but it
   * reads as two independent facts and invites a later edit that keeps the
   * first and drops the second. Filtering on the pair makes "was this partner
   * invited" the same query as "does this exist" — there is no ordering in
   * which the check can be skipped.
   *
   * ⚠️ Both filter values are non-empty by the guard above. `filters: { id:
   * undefined }` is NO filter, not "no rows" — the read that took every
   * storefront down (#1397).
   */
  const responses = await service.listDesignInquiryResponses(
    { inquiry_id: input.inquiry_id, partner_id: input.partner_id } as any,
    { take: 1 }
  )
  const response = responses?.[0]
  if (!response) {
    throw notFound()
  }

  const inquiries = await service.listDesignInquiries(
    { id: input.inquiry_id } as any,
    { take: 1 }
  )
  const inquiry = inquiries?.[0]
  if (!inquiry) {
    // A response whose inquiry is gone. Nothing to answer.
    throw notFound()
  }

  return { inquiry, response }
}

/**
 * The inquiry's questions, in the order they were generated.
 *
 * 🔑 Read from the persisted rows, never regenerated from the design's current
 * spec. The spec moves while sourcing is in progress — that is why the inquiry
 * records `spec_version` at all — and a wizard that silently reworded itself
 * between being sent and being answered would make every answer unreadable.
 */
export const listInquiryQuestions = async (
  scope: any,
  inquiryId: string
): Promise<any[]> => {
  const service: DesignInquiryService = scope.resolve(DESIGN_INQUIRY_MODULE)
  const questions = await service.listDesignInquiryQuestions(
    { inquiry_id: inquiryId } as any,
    { order: { order: "ASC" } }
  )
  return questions ?? []
}

/** This partner's answers so far, so a half-finished wizard resumes. */
export const listResponseAnswers = async (
  scope: any,
  responseId: string
): Promise<any[]> => {
  const service: DesignInquiryService = scope.resolve(DESIGN_INQUIRY_MODULE)
  const answers = await service.listDesignInquiryAnswers(
    { response_id: responseId } as any
  )
  return answers ?? []
}

/**
 * PURE: are these answers ones this inquiry actually asked?
 *
 * 🔴 BOTH ENDS OF THE REQUEST NAME AN ID (#1404). The URL names the inquiry
 * and the body names question ids, and two partner routes have already shipped
 * checking only the URL — writing against ids the caller supplied, belonging
 * to a record they were never granted.
 *
 * Here that would let an invited partner write an answer onto ANOTHER
 * inquiry's question by id, and the admin comparison view — which reads
 * answers through the response — would show it as this partner's reply to a
 * question they were never asked.
 *
 * Returns the offending ids rather than a boolean, so the caller can name them
 * in the error. Duplicates inside one payload are rejected too: two answers to
 * one question have no defined winner, and the unique index would reject the
 * second write anyway, one row after the first had already landed.
 */
export const findUnaskedQuestionIds = (
  questions: Array<{ id?: string | null }>,
  answers: Array<{ question_id?: string | null }>
): { unknown_ids: string[]; duplicate_ids: string[] } => {
  const asked = new Set(
    (questions ?? []).map((q) => String(q?.id ?? "")).filter(Boolean)
  )

  const unknown: string[] = []
  const duplicates: string[] = []
  const seen = new Set<string>()

  for (const answer of answers ?? []) {
    const id = String(answer?.question_id ?? "").trim()
    if (!id || !asked.has(id)) {
      unknown.push(id || "(missing)")
      continue
    }
    if (seen.has(id)) {
      duplicates.push(id)
      continue
    }
    seen.add(id)
  }

  return {
    unknown_ids: Array.from(new Set(unknown)),
    duplicate_ids: Array.from(new Set(duplicates)),
  }
}

/**
 * PURE: may this partner still write to this inquiry?
 *
 * A closed inquiry is a decision that has already been made — someone was
 * chosen, and the prospect grants were withdrawn. Accepting an answer into it
 * would record a reply to a question that is no longer live and, worse, would
 * appear in the comparison as though it had been considered.
 *
 * 🔑 Submitting is NOT final while the inquiry is open. A partner who finds
 * a better yarn on Thursday should be able to say so, and a wizard that locks
 * on first submit teaches people to delay answering until they are certain —
 * which is precisely the silence this feature exists to end. `submitted_at`
 * moves to the latest submission.
 */
export const inquiryWriteRefusal = (inquiry: {
  status?: string | null
}): string | null => {
  if (String(inquiry?.status ?? "") === "closed") {
    return "This inquiry has been closed, so it can no longer be answered. If something has changed, tell us directly and we will re-open it."
  }
  return null
}
