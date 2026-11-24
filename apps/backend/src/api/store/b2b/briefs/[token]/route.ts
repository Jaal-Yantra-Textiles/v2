import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import { PARTNER_QUOTE_MODULE } from "../../../../../modules/partner-quote"
import { BriefAnswerError, missingRequired, validateBriefAnswer } from "../../../../../modules/partner-quote/lib/brief-answers"
import { buildBriefView } from "../../../../../modules/partner-quote/lib/brief-view"
import { recordBriefInCrm } from "../../../../../modules/partner-quote/lib/brief-crm"
import { assertQuoteVisibleToCaller } from "../../../../../modules/partner-quote/lib/quote-tenant-guard"
import { hashQuoteToken } from "../../../../../modules/partner-quote/lib/token"
import type { StoreSubmitQuoteBriefReqType } from "../../../../admin/quote-briefs/validators"

/**
 * The buyer's brief page (#2608 S1). The token is the only credential, as on
 * a quote: no login, multi-view, sha256 lookup, and the brief only renders
 * through the LEAD partner's own store key (the quote tenant guard).
 *
 * She can change her answers and picks while the brief is open or submitted;
 * once samples are being made (`sampling`) it is read-only, because the
 * workshops are working from what she sent.
 */
const EDITABLE = new Set(["open", "submitted"])

const loadBrief = async (req: MedusaRequest) => {
  const service: any = req.scope.resolve(PARTNER_QUOTE_MODULE)
  const token = String(req.params.token || "")
  // An empty hash would be NO FILTER and return somebody's brief.
  if (!token) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Brief not found")
  const rows = await service.listPartnerQuoteBriefs({ token_hash: hashQuoteToken(token) })
  const brief = rows?.[0]
  if (!brief) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Brief not found")
  await assertQuoteVisibleToCaller(req, brief)
  return { service, brief }
}

/** The page's /<country>/ segment decides the estimate currency. */
const countryOf = (req: MedusaRequest) =>
  typeof req.query.country === "string" ? req.query.country : null

const linkState = (brief: any, now: Date) =>
  brief.status === "closed"
    ? "closed"
    : brief.expires_at && new Date(brief.expires_at).getTime() <= now.getTime()
      ? "expired"
      : "live"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { service, brief } = await loadBrief(req)
  const now = new Date()
  // Fire-and-forget: view tracking must never break the page.
  service
    .updatePartnerQuoteBriefs({ id: brief.id, last_viewed_at: now, view_count: (brief.view_count ?? 0) + 1 })
    .catch(() => undefined)
  const view = await buildBriefView(req.scope, brief.id, { audience: "buyer", country: countryOf(req) })
  const state = linkState(brief, now)
  res.json({ brief: { ...view, link_state: state, editable: state === "live" && EDITABLE.has(brief.status) } })
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { service, brief } = await loadBrief(req)
  const now = new Date()
  if (linkState(brief, now) !== "live" || !EDITABLE.has(brief.status)) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      brief.status === "sampling"
        ? "Your samples are being made from these answers, so they can't be changed here. Message us instead."
        : "This brief can no longer be changed."
    )
  }
  const body = req.validatedBody as StoreSubmitQuoteBriefReqType

  const questions = await service.listPartnerQuoteBriefQuestions({ brief_id: brief.id })
  const byKey = new Map<string, any>(questions.map((q: any) => [q.key, q]))
  const answerUpdates: any[] = []
  try {
    for (const [key, raw] of Object.entries(body.answers ?? {})) {
      const q = byKey.get(key)
      if (!q) throw new BriefAnswerError(`unknown question "${key}"`)
      const answer = validateBriefAnswer(q, raw, q.answer)
      answerUpdates.push({ id: q.id, answer, answered_at: answer === null ? null : now })
      q.answer = answer
    }
  } catch (e) {
    if (e instanceof BriefAnswerError) throw new MedusaError(MedusaError.Types.INVALID_DATA, e.message)
    throw e
  }

  const options = await service.listPartnerQuoteBriefOptions({ brief_id: brief.id })
  const optionIds = new Set<string>(options.map((o: any) => o.id))
  if (body.selected_option_ids) {
    const bad = body.selected_option_ids.filter((id) => !optionIds.has(id))
    if (bad.length) throw new MedusaError(MedusaError.Types.INVALID_DATA, `Unknown option(s): ${bad.join(", ")}`)
  }

  const stepUpdates: any[] = []
  if (body.step_choices && Object.keys(body.step_choices).length) {
    const stepIds = Object.keys(body.step_choices)
    const steps = await service.listPartnerQuoteBriefSteps({ id: stepIds })
    const stepById = new Map<string, any>(steps.map((s: any) => [s.id, s]))
    const choices = await service.listPartnerQuoteBriefChoices({ step_id: stepIds })
    for (const [stepId, choiceId] of Object.entries(body.step_choices)) {
      const step = stepById.get(stepId)
      // A step from another brief is "unknown" here, never "not yours".
      if (!step || !optionIds.has(step.option_id)) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, `Unknown step ${stepId}`)
      }
      if (choiceId && !choices.some((c: any) => c.id === choiceId && c.step_id === stepId)) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, `That partner is not offered for step "${step.label}"`)
      }
      stepUpdates.push({ id: stepId, selected_choice_id: choiceId ?? null })
    }
  }

  if (body.submit) {
    const missing = missingRequired(questions)
    if (missing.length) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, `Please answer: ${missing.join("; ")}`)
    }
    const selected = body.selected_option_ids ?? options.filter((o: any) => o.buyer_selected).map((o: any) => o.id)
    if (!selected.length) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Please pick at least one option you're interested in.")
    }
  }

  if (answerUpdates.length) await service.updatePartnerQuoteBriefQuestions(answerUpdates)
  if (stepUpdates.length) await service.updatePartnerQuoteBriefSteps(stepUpdates)
  if (body.selected_option_ids) {
    const chosen = new Set(body.selected_option_ids)
    await service.updatePartnerQuoteBriefOptions(
      options.map((o: any) => ({ id: o.id, buyer_selected: chosen.has(o.id) }))
    )
  }
  if (body.submit) {
    await service.updatePartnerQuoteBriefs({
      id: brief.id,
      status: "submitted",
      submitted_at: brief.submitted_at ?? now,
    })
    await service.createPartnerQuoteBriefUpdates({
      brief_id: brief.id,
      kind: "note",
      message: brief.submitted_at
        ? "You updated your brief. We'll take the changes into account."
        : "Thanks, we have your brief. We'll check with the workshops and update you here.",
      actor_type: "system",
    })
  }

  const fresh = await service.retrievePartnerQuoteBrief(brief.id)
  const view = await buildBriefView(req.scope, brief.id, { audience: "buyer", country: countryOf(req) })

  // CRM intake on send. Never fails her send: the brief is already saved.
  if (body.submit) {
    try {
      await recordBriefInCrm(req.scope, fresh, view)
    } catch (e: any) {
      req.scope
        .resolve(ContainerRegistrationKeys.LOGGER)
        .error(`[brief] CRM intake failed for ${brief.id}: ${e?.message ?? e}`)
    }
  }
  res.json({
    brief: { ...view, link_state: linkState(fresh, now), editable: EDITABLE.has(fresh.status) },
  })
}
