import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { CRM_MODULE } from "../../../../../modules/crm";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CRM_MODULE);
  const crm_activity = await service.retrieveCrmActivity(req.params.id);
  res.json({ crm_activity });
};

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CRM_MODULE);
  const crm_activity = await service.updateCrmActivities({
    id: req.params.id,
    ...(req.validatedBody as Record<string, unknown>),
  });
  // Correcting an activity's direction or time changes what the engagement
  // state should be, so the cache is refreshed here too.
  if (crm_activity?.related_type === "person" && crm_activity?.related_id) {
    await service.refreshCrmEngagement(crm_activity.related_id).catch(() => {});
  }
  res.json({ crm_activity });
};

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CRM_MODULE);
  const existing = await service.retrieveCrmActivity(req.params.id).catch(() => null);
  await service.deleteCrmActivities(req.params.id);
  if (existing?.related_type === "person" && existing?.related_id) {
    await service.refreshCrmEngagement(existing.related_id).catch(() => {});
  }
  res.json({ id: req.params.id, object: "crm_activity", deleted: true });
};
