import { SOCIALS_MODULE } from "../../../../modules/socials"
import { CRM_MODULE } from "../../../../modules/crm"
import {
  CRM_EXTERNAL_SYSTEM,
  planLeadImport,
  summarizeLeadImport,
  type LeadImportAction,
  type LeadSource,
} from "../../../../modules/crm/lead-to-crm"
import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

/**
 * Import ad-leads into the CRM as contacts.
 *
 * `socials.Lead` is where every ad channel already lands (Meta leadgen webhook,
 * Facebook webhook, the manual sync pull, the email-ingest job). This job is the
 * missing way OUT: it materializes each lead as a `crm_person` and stamps the
 * lead's long-unused `external_id` / `external_system` / `synced_to_external_at`
 * fields with the contact it produced.
 *
 * It creates CONTACTS ONLY — never opportunities. A nine-month-old form fill is
 * not a deal, and seeding the pipeline board with 230 of them would make the
 * board lie on the day it ships. An opportunity is created when somebody
 * actually qualifies the lead.
 *
 * Idempotent and convergent on two independent keys (the lead's stamp and the
 * `crm_person` email uniqueness index) — see `planLeadImport`. A settled import
 * re-runs as a pure no-op.
 *
 * ⚠️ The CRM is NOT Postgres. Writes go Medusa -> proxy -> Cloudflare tunnel ->
 * the Autobase node on the OCI VM, one HTTP call per contact. There is no
 * transaction spanning the CRM write and the Postgres stamp, so the stamp is
 * written immediately after each contact rather than batched at the end: a
 * crash mid-run then leaves contacts that are correctly stamped, and the
 * remainder simply unimported. The reverse order would orphan contacts the next
 * run would duplicate.
 */
export const importLeadsToCrmJob: MaintenanceJob = {
  id: "import-leads-to-crm",
  label: "Import ad-leads into the CRM",
  description:
    "Materialize socials leads (Meta/Instagram/Facebook ads, email intake) as CRM contacts, and stamp each lead with the crm_person it produced. Creates contacts only — never opportunities. Idempotent: a lead already stamped, or an email the CRM already holds, is skipped or linked rather than duplicated. Dry-run reports the plan without writing.",
  params: [
    {
      name: "source_platform",
      type: "string",
      required: false,
      description:
        "Only import leads from one source (fb, ig, facebook, email). Omit for all sources.",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: "Cap how many leads to consider in one run (default 500).",
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const socialsService: any = container.resolve(SOCIALS_MODULE)
    const crmService: any = container.resolve(CRM_MODULE)

    const limit = Math.max(1, Number(params.limit ?? 500) || 500)
    const sourceFilter = (params.source_platform as string | undefined)?.trim()

    const filters: Record<string, unknown> = {}
    if (sourceFilter) filters.source_platform = sourceFilter

    const leads: LeadSource[] = await socialsService.listLeads(filters, {
      select: [
        "id",
        "email",
        "phone",
        "full_name",
        "first_name",
        "last_name",
        "company_name",
        "job_title",
        "city",
        "state",
        "country",
        "source_platform",
        "campaign_name",
        "campaign_id",
        "ad_name",
        "form_name",
        "created_time",
        "status",
        "external_id",
        "external_system",
      ],
      take: limit,
    })

    // Existing contacts, keyed by email — the second idempotency key. Read once
    // up front rather than probing per lead: that is one call to the CRM node
    // instead of N over a Cloudflare tunnel.
    const existingByEmail: Record<string, string> = {}
    const existing: any[] = await crmService
      .listCrmPeople({}, { take: null })
      .catch(() => [])
    for (const p of existing) {
      if (p?.email) existingByEmail[String(p.email).toLowerCase()] = p.id
    }

    const plan = planLeadImport(leads, existingByEmail)
    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []

    if (dry_run) {
      for (const action of plan.actions) {
        if (action.kind === "skip") continue
        changes.push(describe(action, null))
      }
      return {
        job_id: importLeadsToCrmJob.id,
        dry_run: true,
        applied: false,
        summary: `${summarizeLeadImport(plan, true)} Scanned ${leads.length} lead(s); CRM currently holds ${existing.length} contact(s).`,
        changes,
      }
    }

    let applied = false
    for (const action of plan.actions) {
      if (action.kind === "skip") continue
      try {
        let crmPersonId: string
        if (action.kind === "create") {
          const created = await crmService.createCrmPeople(action.draft)
          crmPersonId = Array.isArray(created) ? created[0].id : created.id
        } else {
          crmPersonId = action.crm_person_id
        }

        // Stamp immediately — see the ordering note in the doc comment.
        await socialsService.updateLeads([
          {
            id: action.lead.id,
            external_id: crmPersonId,
            external_system: CRM_EXTERNAL_SYSTEM,
            synced_to_external_at: new Date(),
          },
        ])

        applied = true
        changes.push(describe(action, crmPersonId))
      } catch (e: any) {
        // One bad lead must not abort the batch — the remaining contacts are
        // still worth importing, and the failure is reported per-id.
        errors.push({ id: action.lead.id, message: e?.message ?? String(e) })
      }
    }

    return {
      job_id: importLeadsToCrmJob.id,
      dry_run: false,
      applied,
      summary: `${summarizeLeadImport(plan, false)} Scanned ${leads.length} lead(s).${
        errors.length ? ` ${errors.length} failed.` : ""
      }`,
      changes,
      ...(errors.length ? { errors } : {}),
    }
  },
}

function describe(
  action: Extract<LeadImportAction, { kind: "create" | "link" }>,
  crmPersonId: string | null
): MaintenanceChange {
  return {
    entity: "lead",
    id: action.lead.id,
    field: "external_id",
    before: action.lead.external_id ?? null,
    after:
      crmPersonId ??
      (action.kind === "link"
        ? action.crm_person_id
        : `(new crm_person for ${action.draft.email})`),
  }
}
