import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import type { AdminCreateQuoteBriefReqType } from "../../api/admin/quote-briefs/validators"
import { PARTNER_CAPABILITY_MODULE } from "../../modules/partner_capability"
import { PARTNER_QUOTE_MODULE } from "../../modules/partner-quote"
import { DEFAULT_BRIEF_QUESTIONS } from "../../modules/partner-quote/lib/brief-answers"

export type CreateQuoteBriefInput = AdminCreateQuoteBriefReqType & { created_by?: string | null }

/**
 * #2608 S1 — create a quote brief: the lead partner's link-to-be, its options,
 * the partners per step and the buyer's questions. Writes no token (the brief
 * stays a draft until opened) and sends nothing.
 *
 * 🔴 A choice's rate and samples must belong to THAT choice's partner. The
 * buyer sees the partner's name beside the price and the photos; a rate id
 * pasted from another workshop would show one workshop's price under
 * another's name.
 */
const createQuoteBriefStep = createStep(
  "create-quote-brief-step",
  async (input: CreateQuoteBriefInput, { container }) => {
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const capability: any = container.resolve(PARTNER_CAPABILITY_MODULE)
    const service: any = container.resolve(PARTNER_QUOTE_MODULE)

    const { data: leads } = await query.graph({
      entity: "partners",
      fields: ["id", "name", "stores.id"],
      filters: { id: input.partner_id },
    })
    const lead = (leads as any[])[0]
    if (!lead) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Lead partner ${input.partner_id} not found`)
    if (!lead.stores?.[0]?.id) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `${lead.name || input.partner_id} has no store, so a brief link cannot be served from it. Pick a lead partner with a storefront.`
      )
    }

    const choices = input.options.flatMap((o) => o.steps.flatMap((s) => s.choices))
    const partnerIds = [...new Set(choices.map((c) => c.partner_id))]
    const rateIds = [...new Set(choices.map((c) => c.rate_id).filter((x): x is string => !!x))]
    const sampleIds = [...new Set(choices.flatMap((c) => c.sample_ids ?? []))]

    if (partnerIds.length) {
      const { data: found } = await query.graph({ entity: "partners", fields: ["id"], filters: { id: partnerIds } })
      const have = new Set((found as any[]).map((p) => p.id))
      const missing = partnerIds.filter((id) => !have.has(id))
      if (missing.length) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Unknown partner(s): ${missing.join(", ")}`)
    }
    const rates = rateIds.length ? await capability.listPartnerCapabilityRates({ id: rateIds }) : []
    const samples = sampleIds.length ? await capability.listPartnerCapabilitySamples({ id: sampleIds }) : []
    const rateOwner = new Map<string, string>(rates.map((r: any) => [r.id, r.partner_id]))
    const sampleOwner = new Map<string, string>(samples.map((s: any) => [s.id, s.partner_id]))
    for (const c of choices) {
      if (c.rate_id && rateOwner.get(c.rate_id) !== c.partner_id) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          rateOwner.has(c.rate_id)
            ? `Rate ${c.rate_id} belongs to another partner, not ${c.partner_id}`
            : `Rate ${c.rate_id} not found`
        )
      }
      for (const sid of c.sample_ids ?? []) {
        if (sampleOwner.get(sid) !== c.partner_id) {
          throw new MedusaError(
            MedusaError.Types.INVALID_DATA,
            sampleOwner.has(sid) ? `Sample ${sid} belongs to another partner, not ${c.partner_id}` : `Sample ${sid} not found`
          )
        }
      }
    }

    const brief = await service.createPartnerQuoteBriefs({
      partner_id: input.partner_id,
      store_id: lead.stores[0].id,
      title: input.title,
      intro: input.intro ?? null,
      destination_country_code: input.destination_country_code.toLowerCase(),
      currency_code: (input.currency_code ?? "inr").toLowerCase(),
      sample_quantity: input.sample_quantity ?? null,
      customer_id: input.customer_id ?? null,
      buyer_email: input.buyer_email ?? null,
      recipient_name: input.recipient_name ?? null,
      recipient_company: input.recipient_company ?? null,
      status: "draft",
      token_hash: null,
      created_by: input.created_by ?? null,
    })

    try {
      for (const [oi, o] of input.options.entries()) {
        const option = await service.createPartnerQuoteBriefOptions({
          brief_id: brief.id,
          title: o.title,
          description: o.description ?? null,
          story: o.story ?? null,
          position: oi,
        })
        for (const [si, s] of o.steps.entries()) {
          const step = await service.createPartnerQuoteBriefSteps({
            option_id: option.id,
            position: si,
            label: s.label,
            kind: s.kind ?? (s.technique ? "process" : "fabric"),
            technique: s.technique ?? null,
            qty_per_piece: s.qty_per_piece ?? null,
            note: s.note ?? null,
          })
          if (s.choices.length) {
            await service.createPartnerQuoteBriefChoices(
              s.choices.map((c, ci) => ({
                step_id: step.id,
                partner_id: c.partner_id,
                rate_id: c.rate_id ?? null,
                sample_ids: c.sample_ids?.length ? c.sample_ids : null,
                note: c.note ?? null,
                position: ci,
              }))
            )
          }
        }
      }
      // Without an email on the brief, the CRM intake has no way back to her.
      const questions = input.questions ?? [
        ...(input.buyer_email
          ? []
          : [{ key: "email", label: "Your email", kind: "text", required: true, help: "So we can send you updates and the quote" }]),
        ...DEFAULT_BRIEF_QUESTIONS,
      ]
      const keys = questions.map((q) => q.key)
      if (new Set(keys).size !== keys.length) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, "Question keys must be unique within a brief")
      }
      await service.createPartnerQuoteBriefQuestions(
        questions.map((q: any, qi: number) => ({
          brief_id: brief.id,
          key: q.key,
          label: q.label,
          help: q.help ?? null,
          kind: q.kind,
          options: q.options ?? null,
          required: !!q.required,
          position: qi,
        }))
      )
    } catch (e) {
      // Children first, then the brief, so a half-written brief never lingers.
      await removeBrief(service, brief.id)
      throw e
    }

    return new StepResponse({ id: brief.id }, { id: brief.id })
  },
  async (comp: { id: string } | undefined, { container }) => {
    if (!comp) return
    await removeBrief(container.resolve(PARTNER_QUOTE_MODULE), comp.id)
  }
)

const removeBrief = async (service: any, id: string) => {
  const options = await service.listPartnerQuoteBriefOptions({ brief_id: id }, { select: ["id"] })
  const optionIds = options.map((o: any) => o.id)
  const steps = optionIds.length
    ? await service.listPartnerQuoteBriefSteps({ option_id: optionIds }, { select: ["id"] })
    : []
  const stepIds = steps.map((s: any) => s.id)
  if (stepIds.length) {
    const ch = await service.listPartnerQuoteBriefChoices({ step_id: stepIds }, { select: ["id"] })
    if (ch.length) await service.deletePartnerQuoteBriefChoices(ch.map((c: any) => c.id))
    await service.deletePartnerQuoteBriefSteps(stepIds)
  }
  if (optionIds.length) await service.deletePartnerQuoteBriefOptions(optionIds)
  const qs = await service.listPartnerQuoteBriefQuestions({ brief_id: id }, { select: ["id"] })
  if (qs.length) await service.deletePartnerQuoteBriefQuestions(qs.map((q: any) => q.id))
  await service.deletePartnerQuoteBriefs(id)
}

export const createQuoteBriefWorkflow = createWorkflow(
  "create-quote-brief",
  (input: CreateQuoteBriefInput) => {
    const result = createQuoteBriefStep(input)
    return new WorkflowResponse(result)
  }
)
