import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";

import { CRM_MODULE } from "../../../../../../modules/crm";
import {
  CRM_EXTERNAL_SYSTEM,
  planLeadImport,
  type LeadSource,
} from "../../../../../../modules/crm/lead-to-crm";
import { SOCIALS_MODULE } from "../../../../../../modules/socials";

/**
 * POST /admin/crm/leads/:id/import — promote ONE ad-lead into a CRM contact.
 *
 * The per-lead counterpart to the `import-leads-to-crm` maintenance job, and it
 * shares the job's planner rather than restating the rules: same idempotency
 * (the lead's `external_id` stamp, and the `crm_person` email index), same
 * name derivation, same "contacts only, never opportunities" policy.
 *
 * Answers 200 in every non-error case, with `action` saying what happened —
 * `created`, `linked` (an existing contact already held that email) or
 * `already_imported`. A second click is a no-op, not a duplicate and not a 409:
 * the caller's intent ("this lead should be in the CRM") is satisfied either
 * way, and the button that fires this is exactly the kind a user double-clicks.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params;
  const socialsService: any = req.scope.resolve(SOCIALS_MODULE);
  const crmService: any = req.scope.resolve(CRM_MODULE);

  const leads: LeadSource[] = await socialsService.listLeads(
    { id },
    { take: 1 }
  );
  const lead = leads?.[0];
  if (!lead) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Lead ${id} not found`);
  }

  // Only the contacts that could collide — one narrow read instead of the whole
  // book, since a single promotion needs exactly one email checked.
  const email = (lead.email ?? "").trim().toLowerCase();
  const existingByEmail: Record<string, string> = {};
  if (email) {
    const matches: any[] = await crmService
      .listCrmPeople({ email }, { take: 1 })
      .catch(() => []);
    if (matches?.[0]) existingByEmail[email] = matches[0].id;
  }

  const plan = planLeadImport([lead], existingByEmail);
  const action = plan.actions[0];

  if (action.kind === "skip") {
    if (action.reason === "already_imported") {
      return res.json({
        action: "already_imported",
        lead_id: lead.id,
        crm_person_id: lead.external_id,
      });
    }
    // A lead with no usable email or name cannot become a contact — that is a
    // property of the data, so say which, rather than failing opaquely.
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      action.reason === "no_usable_email"
        ? `Lead ${id} has no usable email address, so it cannot be imported (the CRM keys contacts on email).`
        : `Lead ${id} has no usable name, so it cannot be imported.`
    );
  }

  let crmPersonId: string;
  if (action.kind === "create") {
    const created = await crmService.createCrmPeople(action.draft);
    crmPersonId = Array.isArray(created) ? created[0].id : created.id;
  } else {
    crmPersonId = action.crm_person_id;
  }

  await socialsService.updateLeads([
    {
      id: lead.id,
      external_id: crmPersonId,
      external_system: CRM_EXTERNAL_SYSTEM,
      synced_to_external_at: new Date(),
      // Promoting a lead is the act of working it, so it stops being `new`.
      // Deliberately NOT `qualified`: importing a contact is not a judgement
      // that the deal is real — that is what opening an opportunity means.
      ...(lead.status === "new" ? { status: "contacted", contacted_at: new Date() } : {}),
    },
  ]);

  res.json({
    action: action.kind === "create" ? "created" : "linked",
    lead_id: lead.id,
    crm_person_id: crmPersonId,
  });
};
