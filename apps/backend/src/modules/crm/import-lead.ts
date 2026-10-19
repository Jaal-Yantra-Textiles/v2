import { CRM_MODULE } from "./index"
import {
  CRM_EXTERNAL_SYSTEM,
  planLeadImport,
  type LeadSkipReason,
  type LeadSource,
} from "./lead-to-crm"
import { SOCIALS_MODULE } from "../socials"

export type LeadImportOutcome =
  | { action: "created" | "linked"; crm_person_id: string }
  | { action: "already_imported"; crm_person_id: string | null }
  | { action: "skipped"; reason: Exclude<LeadSkipReason, "already_imported"> }

/**
 * Promote ONE `socials.Lead` into a CRM contact, with the same planner, the
 * same idempotency (the lead's `external_id` stamp, the `crm_person` email
 * index) and the same "contacts only, never opportunities" policy as the
 * `import-leads-to-crm` job. Shared by the admin import button and the
 * storefront's story request.
 *
 * `markContacted`: an admin importing a lead is working it, so it leaves
 * `new`. A shopper's own request is not a contact we made, so that caller
 * keeps the lead `new` for somebody to follow up.
 */
export async function importLeadToCrm(
  scope: { resolve: (key: string) => any },
  lead: LeadSource & { status?: string | null },
  opts: { markContacted?: boolean } = {}
): Promise<LeadImportOutcome> {
  const socialsService: any = scope.resolve(SOCIALS_MODULE)
  const crmService: any = scope.resolve(CRM_MODULE)

  // Only the contact that could collide: one narrow read for one email.
  const email = (lead.email ?? "").trim().toLowerCase()
  const existingByEmail: Record<string, string> = {}
  if (email) {
    const matches: any[] = await crmService
      .listCrmPeople({ email }, { take: 1 })
      .catch(() => [])
    if (matches?.[0]) existingByEmail[email] = matches[0].id
  }

  const action = planLeadImport([lead], existingByEmail).actions[0]
  if (action.kind === "skip") {
    return action.reason === "already_imported"
      ? { action: "already_imported", crm_person_id: (lead as any).external_id ?? null }
      : { action: "skipped", reason: action.reason }
  }

  let crmPersonId: string
  if (action.kind === "create") {
    const created = await crmService.createCrmPeople(action.draft)
    crmPersonId = Array.isArray(created) ? created[0].id : created.id
  } else {
    crmPersonId = action.crm_person_id
  }

  await socialsService.updateLeads([
    {
      id: lead.id,
      external_id: crmPersonId,
      external_system: CRM_EXTERNAL_SYSTEM,
      synced_to_external_at: new Date(),
      // Deliberately NOT `qualified`: importing a contact is not a judgement
      // that the deal is real — that is what opening an opportunity means.
      ...(opts.markContacted !== false && lead.status === "new"
        ? { status: "contacted", contacted_at: new Date() }
        : {}),
    },
  ])

  return { action: action.kind === "create" ? "created" : "linked", crm_person_id: crmPersonId }
}
