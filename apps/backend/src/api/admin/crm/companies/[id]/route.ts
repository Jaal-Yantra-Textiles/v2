import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { CRM_MODULE } from "../../../../../modules/crm";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CRM_MODULE);
  const crm_company = await service.retrieveCrmCompany(req.params.id);
  res.json({ crm_company });
};

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CRM_MODULE);
  const crm_company = await service.updateCrmCompanies({
    id: req.params.id,
    ...(req.validatedBody as Record<string, unknown>),
  });
  res.json({ crm_company });
};

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CRM_MODULE);
  await service.deleteCrmCompanies(req.params.id);
  res.json({ id: req.params.id, object: "crm_company", deleted: true });
};
