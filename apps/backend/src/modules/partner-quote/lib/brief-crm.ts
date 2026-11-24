/**
 * #2608 — a sent brief is a sales lead: put it in the CRM where someone works it.
 *
 * Same path the storefront's other intakes use (production-story share): a
 * socials `Lead` row keyed by the brief (idempotent), then `importLeadToCrm`
 * for the contact. On top: one opportunity per brief, and a note with what she
 * picked. A re-send adds a note, never a second opportunity.
 *
 * 🔑 Never throws into the buyer's request: the brief is already saved, and a
 * CRM hiccup must not tell her "could not send". The caller logs the error.
 */
import { CRM_MODULE } from "../../crm"
import { importLeadToCrm } from "../../crm/import-lead"
import { SOCIALS_MODULE } from "../../socials"
import { createOpportunityWorkflow } from "../../../workflows/crm/create-opportunity"
import { PARTNER_QUOTE_MODULE } from ".."

export const summariseBrief = (view: any): string => {
  const picked = (view.options ?? []).filter((o: any) => o.buyer_selected)
  const lines = [`Brief "${view.title}"${view.recipient_name ? ` from ${view.recipient_name}` : ""}.`]
  for (const o of picked) {
    lines.push(`• ${o.title}`)
    for (const s of o.steps ?? []) {
      const pick = (s.choices ?? []).find((c: any) => c.id === s.selected_choice_id)
      const who =
        s.state === "exploring" ? "no partner yet" : pick ? pick.partner.name : `open: ${(s.choices ?? []).map((c: any) => c.partner.name).join(" / ")}`
      lines.push(`   – ${s.label}: ${who}`)
    }
    const e = o.estimate
    if (e?.per_piece_high > 0) {
      lines.push(
        `   estimate ${e.currency_code.toUpperCase()} ${e.per_piece_low}–${e.per_piece_high}/piece${e.complete ? "" : " so far"}` +
          (e.total_low != null ? `, ${e.quantity} pcs ${e.total_low}–${e.total_high}` : "") +
          (e.pending_steps?.length ? `; to confirm: ${e.pending_steps.join(", ")}` : "")
      )
    }
  }
  for (const q of view.questions ?? []) {
    if (q.answer == null || (Array.isArray(q.answer) && !q.answer.length)) continue
    const a = q.kind === "file" ? (q.answer as any[]).map((f) => `${f.name} ${f.url}`).join(", ") : Array.isArray(q.answer) ? q.answer.join(", ") : String(q.answer)
    lines.push(`${q.label} ${a}`)
  }
  return lines.join("\n")
}

export const recordBriefInCrm = async (
  scope: { resolve: (k: string) => any },
  brief: any,
  view: any
): Promise<{ crm_person_id: string | null; crm_opportunity_id: string | null; action: string }> => {
  const quotes: any = scope.resolve(PARTNER_QUOTE_MODULE)
  const crm: any = scope.resolve(CRM_MODULE)
  const summary = summariseBrief(view)

  // Already in the CRM: a re-send is a note on the same opportunity.
  if (brief.crm_opportunity_id) {
    await crm.createCrmNotes({
      body: `Buyer updated the brief.\n${summary}`,
      related_type: "opportunity",
      related_id: brief.crm_opportunity_id,
      metadata: { brief_id: brief.id },
    })
    return { crm_person_id: brief.crm_person_id ?? null, crm_opportunity_id: brief.crm_opportunity_id, action: "noted" }
  }

  const emailAnswer = (view.questions ?? []).find((q: any) => q.key === "email")?.answer
  const email = String(brief.buyer_email ?? emailAnswer ?? "").trim().toLowerCase() || null

  const socials: any = scope.resolve(SOCIALS_MODULE)
  const key = `brief:${brief.id}`
  const [existing] = await socials.listLeads({ meta_lead_id: key }, { take: 1 })
  const lead =
    existing ??
    (await socials.createLeads({
      meta_lead_id: key,
      email,
      full_name: brief.recipient_name ?? null,
      company_name: brief.recipient_company ?? null,
      country: brief.destination_country_code ?? null,
      created_time: new Date(),
      source_platform: "storefront",
      form_name: "quote_brief",
      notes: summary.slice(0, 2000),
      field_data: { brief_id: brief.id, partner_id: brief.partner_id, title: brief.title },
    }))

  const outcome: any = await importLeadToCrm(scope, lead, { markContacted: false })
  const personId: string | null = outcome?.crm_person_id ?? null

  const picked = (view.options ?? []).filter((o: any) => o.buyer_selected)
  const amount = picked.map((o: any) => o.estimate?.total_low).find((x: any) => typeof x === "number") ?? null
  const { result: opp } = await createOpportunityWorkflow(scope as any).run({
    input: {
      title: `Brief: ${brief.title}${brief.recipient_company ? ` (${brief.recipient_company})` : ""}`,
      amount,
      currency: (view.currency_code ?? "inr").toLowerCase(),
      owner_person_id: personId,
      metadata: { brief_id: brief.id, partner_id: brief.partner_id, source: "quote_brief", amount_is_estimate: true },
    },
  })
  const oppId: string | null = (opp as any)?.id ?? null
  // Saved BEFORE the note: if the note fails, a re-send must find this
  // opportunity and add a note, not open a second one.
  await quotes.updatePartnerQuoteBriefs({ id: brief.id, crm_person_id: personId, crm_opportunity_id: oppId })
  if (oppId) {
    await crm.createCrmNotes({ body: summary, related_type: "opportunity", related_id: oppId, metadata: { brief_id: brief.id } })
  }
  return { crm_person_id: personId, crm_opportunity_id: oppId, action: outcome?.action ?? "created" }
}
