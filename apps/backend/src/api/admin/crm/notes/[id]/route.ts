import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { CRM_MODULE } from "../../../../../modules/crm";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CRM_MODULE);
  const crm_note = await service.retrieveCrmNote(req.params.id);
  res.json({ crm_note });
};

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CRM_MODULE);
  const crm_note = await service.updateCrmNotes({
    id: req.params.id,
    ...(req.validatedBody as Record<string, unknown>),
  });
  res.json({ crm_note });
};

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CRM_MODULE);
  await service.deleteCrmNotes(req.params.id);
  res.json({ id: req.params.id, object: "crm_note", deleted: true });
};
