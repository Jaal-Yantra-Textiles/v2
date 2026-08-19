import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { CRM_MODULE } from "../../../../../modules/crm";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CRM_MODULE);
  const crm_person = await service.retrieveCrmPerson(req.params.id);
  res.json({ crm_person });
};

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CRM_MODULE);
  const body = req.validatedBody as Record<string, unknown>;
  let crm_person = await service.updateCrmPeople({ id: req.params.id, ...body });

  // Scheduling (or clearing) a follow-up changes what the engagement state
  // should be right now — a date set in the past means the contact is due
  // immediately. Recomputing here keeps the cached state honest without waiting
  // for the nightly sweep to notice.
  if ("next_follow_up_at" in body) {
    await service.refreshCrmEngagement(req.params.id).catch(() => {});
    crm_person = await service.retrieveCrmPerson(req.params.id);
  }

  res.json({ crm_person });
};

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CRM_MODULE);
  await service.deleteCrmPeople(req.params.id);
  res.json({ id: req.params.id, object: "crm_person", deleted: true });
};
