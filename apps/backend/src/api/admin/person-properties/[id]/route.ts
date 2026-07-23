import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { PERSON_PROPERTY_MODULE } from "../../../../modules/personproperty";

// GET /admin/person-properties/:id — retrieve (throws MedusaError NOT_FOUND → 404)
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(PERSON_PROPERTY_MODULE);
  const person_property = await service.retrievePersonProperty(req.params.id);
  res.json({ person_property });
};

// POST /admin/person-properties/:id — update
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(PERSON_PROPERTY_MODULE);
  const person_property = await service.updatePersonProperties({
    id: req.params.id,
    ...(req.validatedBody as Record<string, unknown>),
  });
  res.json({ person_property });
};

// DELETE /admin/person-properties/:id
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(PERSON_PROPERTY_MODULE);
  await service.deletePersonProperties(req.params.id);
  res.json({ id: req.params.id, object: "person_property", deleted: true });
};
