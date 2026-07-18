import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { CRM_MODULE } from "../../../../../modules/crm";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CRM_MODULE);
  const crm_person = await service.retrieveCrmPerson(req.params.id);
  res.json({ crm_person });
};

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CRM_MODULE);
  const crm_person = await service.updateCrmPeople({
    id: req.params.id,
    ...(req.validatedBody as Record<string, unknown>),
  });
  res.json({ crm_person });
};

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CRM_MODULE);
  await service.deleteCrmPeople(req.params.id);
  res.json({ id: req.params.id, object: "crm_person", deleted: true });
};
