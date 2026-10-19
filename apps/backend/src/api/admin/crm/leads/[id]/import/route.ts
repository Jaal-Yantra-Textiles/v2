import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";

import { importLeadToCrm } from "../../../../../../modules/crm/import-lead";
import { type LeadSource } from "../../../../../../modules/crm/lead-to-crm";
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

  const leads: LeadSource[] = await socialsService.listLeads(
    { id },
    { take: 1 }
  );
  const lead = leads?.[0];
  if (!lead) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Lead ${id} not found`);
  }

  const outcome = await importLeadToCrm(req.scope, lead);

  if (outcome.action === "skipped") {
    // A lead with no usable email or name cannot become a contact — that is a
    // property of the data, so say which, rather than failing opaquely.
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      outcome.reason === "no_usable_email"
        ? `Lead ${id} has no usable email address, so it cannot be imported (the CRM keys contacts on email).`
        : `Lead ${id} has no usable name, so it cannot be imported.`
    );
  }

  res.json({
    action: outcome.action,
    lead_id: lead.id,
    crm_person_id: outcome.crm_person_id,
  });
};
