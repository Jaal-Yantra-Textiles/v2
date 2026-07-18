import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { CRM_MODULE } from "../../../../../modules/crm";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CRM_MODULE);
  const crm_opportunity = await service.retrieveCrmOpportunity(req.params.id);
  res.json({ crm_opportunity });
};

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CRM_MODULE);
  const crm_opportunity = await service.updateCrmOpportunities({
    id: req.params.id,
    ...(req.validatedBody as Record<string, unknown>),
  });
  res.json({ crm_opportunity });
};

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CRM_MODULE);
  await service.deleteCrmOpportunities(req.params.id);
  res.json({ id: req.params.id, object: "crm_opportunity", deleted: true });
};
