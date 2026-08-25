import { MedusaError } from "@medusajs/framework/utils"

import { DESIGN_INQUIRY_MODULE } from ".."
import type DesignInquiryService from "../service"
import { PARTNER_CAPABILITY_MODULE } from "../../partner_capability"
import { findUnaskedQuestionIds } from "./partner-inquiry-access"

/**
 * Writing a partner's answers into their own response row (#1531 slice 2).
 *
 * Shared by `POST .../answers` (the wizard autosaving a step) and
 * `POST .../submit` (save-and-submit in one round trip), because two copies of
 * an upsert whose correctness depends on a unique index is two places for the
 * index to start throwing.
 */

export type IncomingAnswer = {
  question_id: string
  value?: unknown
  note?: string | null
  capability_sample_ids?: string[]
}

/**
 * 🔴 UPSERT, and it must be one.
 *
 * `design_inquiry_answer` carries a unique index on `(response_id,
 * question_id)`, so a blind create throws the moment a partner goes back a
 * step and changes their mind — which the wizard actively encourages, since a
 * partner who cannot revise learns to delay answering until they are certain,
 * and that silence is the thing this feature exists to end.
 *
 * Existing rows are read FIRST and matched by question, exactly as
 * `grantProspectAccessStep` reads links before creating them. Same lesson,
 * different table: a constraint you only discover by violating it is a
 * constraint that fails in production (`link.create` is not idempotent, and a
 * comment claimed it was for months).
 */
export const saveInquiryAnswers = async (
  scope: any,
  input: {
    response: { id: string; partner_id: string }
    questions: Array<{ id?: string | null }>
    answers: IncomingAnswer[]
  }
): Promise<{ saved: number; created: number; updated: number }> => {
  const service: DesignInquiryService = scope.resolve(DESIGN_INQUIRY_MODULE)

  const incoming = input.answers ?? []
  if (!incoming.length) return { saved: 0, created: 0, updated: 0 }

  /**
   * 🔴 BOTH ENDS OF THE REQUEST NAME AN ID (#1404). The URL names the inquiry;
   * the body names question ids. Two partner routes have already shipped
   * checking the URL and writing against body ids belonging to a record the
   * caller was never granted.
   */
  const { unknown_ids, duplicate_ids } = findUnaskedQuestionIds(
    input.questions,
    incoming
  )
  if (unknown_ids.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `This inquiry did not ask ${unknown_ids.length === 1 ? "that question" : "those questions"}: ${unknown_ids.join(", ")}`
    )
  }
  if (duplicate_ids.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Two answers were sent for the same question (${duplicate_ids.join(", ")}), and there is no rule for which one wins.`
    )
  }

  await assertCapabilitySamplesBelongToPartner(scope, {
    partner_id: input.response.partner_id,
    sample_ids: incoming.flatMap((a) => a.capability_sample_ids ?? []),
  })

  const existing = await service.listDesignInquiryAnswers({
    response_id: input.response.id,
  } as any)
  const byQuestion = new Map<string, any>(
    (existing ?? []).map((row: any) => [String(row.question_id), row])
  )

  const toCreate: any[] = []
  const toUpdate: any[] = []

  for (const answer of incoming) {
    const questionId = String(answer.question_id)
    const row = {
      value: answer.value === undefined ? null : (answer.value as any),
      note: answer.note ?? null,
      capability_sample_ids: answer.capability_sample_ids?.length
        ? answer.capability_sample_ids
        : null,
    }

    const found = byQuestion.get(questionId)
    if (found) {
      toUpdate.push({ id: found.id, ...row })
    } else {
      toCreate.push({
        response_id: input.response.id,
        question_id: questionId,
        ...row,
      })
    }
  }

  if (toCreate.length) {
    await service.createDesignInquiryAnswers(toCreate as any)
  }
  for (const row of toUpdate) {
    // 🔑 One at a time, in the bare entity form. The `{ selector, data }` bulk
    // form would write ONE payload across many rows, which is the opposite of
    // what is wanted here — every answer differs.
    await service.updateDesignInquiryAnswers(row as any)
  }

  return {
    saved: toCreate.length + toUpdate.length,
    created: toCreate.length,
    updated: toUpdate.length,
  }
}

/**
 * 🔴 A capability sample id in the body is an id the CALLER chose.
 *
 * The samples are a shared library across every partner. Accepting an id
 * without checking who owns it would let a partner attach a competitor's
 * photograph as evidence of their own capability — and it would read as
 * evidence, because the admin comparison renders whatever the answer points
 * at.
 *
 * Silence would be the wrong failure here. An answer that quietly drops its
 * photographs looks answered and is not; the partner is told which ids were
 * refused.
 */
const assertCapabilitySamplesBelongToPartner = async (
  scope: any,
  input: { partner_id: string; sample_ids: string[] }
): Promise<void> => {
  const ids = Array.from(new Set((input.sample_ids ?? []).filter(Boolean)))
  if (!ids.length) return

  const capability: any = scope.resolve(PARTNER_CAPABILITY_MODULE)
  // Filtered on BOTH the ids and the owner. Reading by id and comparing
  // afterwards works too, but this way there is no ordering in which the
  // ownership check can be dropped by a later edit.
  const owned = await capability.listPartnerCapabilitySamples({
    id: ids,
    partner_id: input.partner_id,
  } as any)

  const ownedIds = new Set((owned ?? []).map((s: any) => String(s.id)))
  const refused = ids.filter((id) => !ownedIds.has(id))

  if (refused.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `These samples are not yours to attach: ${refused.join(", ")}`
    )
  }
}
